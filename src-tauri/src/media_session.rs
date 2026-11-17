//! The system media transport controls (SMTC): the Windows flyout that opens on
//! the volume / media keys, and the lock-screen and Bluetooth-headset buttons.
//!
//! WebView2 publishes the embedded YouTube player to SMTC by itself, but under
//! the iframe's own (cross-origin) media session: the title and artwork show,
//! while previous / next stay disabled and nothing the page registers can reach
//! them (T-1273). So the integration is switched off in the WebView
//! ([`disable_webview_media_integration`]) and owned here instead: the frontend
//! pushes what is playing, the buttons come back as `media-session-button`
//! events, and the music store acts on them like on its own buttons.

use serde::Deserialize;

/// Event the frontend listens to; the payload is one of [`BUTTONS`].
pub const BUTTON_EVENT: &str = "media-session-button";

/// What the frontend tells us about playback.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionUpdate {
    /// The loaded video; `None` when nothing is loaded (controls go inert).
    pub video_id: Option<String>,
    pub title: Option<String>,
    pub playing: bool,
}

/// Artwork for a video. The mqdefault image is 16:9 without the letterbox
/// bars the larger ones carry for 4:3 sources.
pub fn thumbnail_url(video_id: &str) -> String {
    format!("https://i.ytimg.com/vi/{video_id}/mqdefault.jpg")
}

/// Arguments that stop WebView2 from registering its own SMTC session.
///
/// Every window of the process shares one WebView2 environment and WebView2
/// refuses to create a window whose browser arguments differ from the first,
/// so this is applied through the environment, not per window. Tauri's own
/// default `--disable-features` list is repeated because only one such switch
/// survives when both sources carry one.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling,MediaSessionService";

/// Must run before the first WebView is created.
pub fn disable_webview_media_integration() {
    const VAR: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    // Someone's own arguments (a debugging port, say) stay; ours go after them.
    let value = match std::env::var(VAR) {
        Ok(existing) if !existing.trim().is_empty() => format!("{existing} {WEBVIEW_ARGS}"),
        _ => WEBVIEW_ARGS.to_string(),
    };
    std::env::set_var(VAR, value);
}

#[cfg(windows)]
mod imp {
    use super::{thumbnail_url, MediaSessionUpdate, BUTTON_EVENT};
    use std::sync::Mutex;
    use tauri::{AppHandle, Emitter, Manager, State};
    use windows::core::{factory, HSTRING};
    use windows::Foundation::{TypedEventHandler, Uri};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    };
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    struct Controls {
        smtc: SystemMediaTransportControls,
        /// The video whose artwork is set, so the same one is not re-fetched
        /// on every pause / resume.
        artwork_for: Option<String>,
    }

    // SAFETY: SystemMediaTransportControls is an agile WinRT object (usable
    // from any thread); the button handler below runs on a pool thread anyway.
    unsafe impl Send for Controls {}

    #[derive(Default)]
    pub struct MediaSession(Mutex<Option<Controls>>);

    fn button_name(button: SystemMediaTransportControlsButton) -> Option<&'static str> {
        if button == SystemMediaTransportControlsButton::Next {
            Some("next")
        } else if button == SystemMediaTransportControlsButton::Previous {
            Some("previous")
        } else if button == SystemMediaTransportControlsButton::Play {
            Some("play")
        } else if button == SystemMediaTransportControlsButton::Pause {
            Some("pause")
        } else {
            None
        }
    }

    fn create(app: &AppHandle) -> Result<Controls, String> {
        let window = app
            .get_webview_window("main")
            .ok_or("main window not found")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd = HWND(hwnd.0 as _);
        let interop =
            factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()
                .map_err(|e| e.to_string())?;
        // SAFETY: `hwnd` is the live main window.
        let smtc: SystemMediaTransportControls =
            unsafe { interop.GetForWindow(hwnd) }.map_err(|e| e.to_string())?;

        let handle = app.clone();
        smtc.ButtonPressed(&TypedEventHandler::<
            SystemMediaTransportControls,
            SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                if let Some(name) = button_name(args.Button()?) {
                    let _ = handle.emit(BUTTON_EVENT, name);
                }
            }
            Ok(())
        }))
        .map_err(|e| e.to_string())?;

        Ok(Controls {
            smtc,
            artwork_for: None,
        })
    }

    fn apply(controls: &mut Controls, update: &MediaSessionUpdate) -> windows::core::Result<()> {
        let smtc = &controls.smtc;
        let active = update.video_id.is_some();
        smtc.SetIsEnabled(active)?;
        smtc.SetIsPlayEnabled(active)?;
        smtc.SetIsPauseEnabled(active)?;
        smtc.SetIsNextEnabled(active)?;
        smtc.SetIsPreviousEnabled(active)?;
        smtc.SetPlaybackStatus(match (active, update.playing) {
            (false, _) => MediaPlaybackStatus::Closed,
            (true, true) => MediaPlaybackStatus::Playing,
            (true, false) => MediaPlaybackStatus::Paused,
        })?;

        let updater = smtc.DisplayUpdater()?;
        if let Some(video_id) = &update.video_id {
            updater.SetType(MediaPlaybackType::Music)?;
            let music = updater.MusicProperties()?;
            music.SetTitle(&HSTRING::from(update.title.as_deref().unwrap_or("")))?;
            if controls.artwork_for.as_deref() != Some(video_id.as_str()) {
                let uri = Uri::CreateUri(&HSTRING::from(thumbnail_url(video_id)))?;
                updater.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(&uri)?)?;
                controls.artwork_for = Some(video_id.clone());
            }
        } else {
            updater.ClearAll()?;
            controls.artwork_for = None;
        }
        updater.Update()
    }

    pub fn update(
        app: &AppHandle,
        state: &State<'_, MediaSession>,
        update: &MediaSessionUpdate,
    ) -> Result<(), String> {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            match create(app) {
                Ok(controls) => {
                    crate::diag!("media session: system media controls attached");
                    *guard = Some(controls);
                }
                Err(e) => {
                    crate::diag!("media session: cannot attach system media controls: {e}");
                    return Err(e);
                }
            }
        }
        let controls = guard.as_mut().ok_or("media session not created")?;
        apply(controls, update).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
pub use imp::MediaSession;

/// Other platforms have no SMTC; the state is empty and the call a no-op.
#[cfg(not(windows))]
#[derive(Default)]
pub struct MediaSession;

/// Pushes the playback state to the system controls, creating them on the
/// first call (they need the main window's handle, which exists by then).
#[tauri::command]
pub fn update_media_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, MediaSession>,
    update: MediaSessionUpdate,
) -> Result<(), String> {
    #[cfg(windows)]
    return imp::update(&app, &state, &update);
    #[cfg(not(windows))]
    {
        let _ = (&app, &state, &update);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnail_points_at_the_video() {
        assert_eq!(
            thumbnail_url("abc123"),
            "https://i.ytimg.com/vi/abc123/mqdefault.jpg"
        );
    }

    #[test]
    fn update_deserializes_from_the_frontend_shape() {
        let update: MediaSessionUpdate =
            serde_json::from_str(r#"{"videoId":"abc","title":"T","playing":true}"#).unwrap();
        assert_eq!(update.video_id.as_deref(), Some("abc"));
        assert!(update.playing);
        let idle: MediaSessionUpdate =
            serde_json::from_str(r#"{"videoId":null,"title":null,"playing":false}"#).unwrap();
        assert_eq!(idle.video_id, None);
    }

    #[test]
    fn webview_args_keep_tauri_defaults_and_turn_the_integration_off() {
        assert!(WEBVIEW_ARGS.contains("msSmartScreenProtection"));
        assert!(WEBVIEW_ARGS.contains("MediaSessionService"));
        assert!(WEBVIEW_ARGS.contains("HardwareMediaKeyHandling"));
    }
}
