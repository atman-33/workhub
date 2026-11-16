// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { isSearchShortcut, type SearchShortcutEvent } from "./search-shortcut";

const press = (over: Partial<SearchShortcutEvent> = {}): SearchShortcutEvent => ({
  key: "/",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  target: document.body,
  ...over,
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isSearchShortcut", () => {
  it("opens on Ctrl+F and Cmd+F, in any case", () => {
    expect(isSearchShortcut(press({ key: "f", ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(press({ key: "F", metaKey: true }))).toBe(true);
  });

  it("opens on Ctrl+F even from inside a field", () => {
    const input = document.body.appendChild(document.createElement("input"));
    expect(isSearchShortcut(press({ key: "f", ctrlKey: true, target: input }))).toBe(true);
  });

  it("ignores Ctrl+F combined with Alt or Shift, and other Ctrl keys", () => {
    expect(isSearchShortcut(press({ key: "f", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ key: "f", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ key: "k", ctrlKey: true }))).toBe(false);
  });

  it("opens on a bare slash outside of fields", () => {
    expect(isSearchShortcut(press())).toBe(true);
    const button = document.body.appendChild(document.createElement("button"));
    expect(isSearchShortcut(press({ target: button }))).toBe(true);
  });

  it("does not take a slash typed into an input, textarea, select or editable element", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.body.appendChild(document.createElement(tag));
      expect(isSearchShortcut(press({ target: el }))).toBe(false);
    }
    const editable = document.body.appendChild(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    const inner = editable.appendChild(document.createElement("span"));
    expect(isSearchShortcut(press({ target: inner }))).toBe(false);
  });

  it("does not take a slash while another dialog has focus", () => {
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    const button = dialog.appendChild(document.createElement("button"));
    expect(isSearchShortcut(press({ target: button }))).toBe(false);
  });

  it("does not take a slash with a modifier or during IME composition", () => {
    expect(isSearchShortcut(press({ ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ altKey: true }))).toBe(false);
    expect(isSearchShortcut(press({ isComposing: true }))).toBe(false);
    expect(isSearchShortcut(press({ key: "f", ctrlKey: true, isComposing: true }))).toBe(false);
  });
});
