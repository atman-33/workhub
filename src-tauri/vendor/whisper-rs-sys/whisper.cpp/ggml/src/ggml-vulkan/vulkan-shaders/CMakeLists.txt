find_package (Threads REQUIRED)
find_package(Vulkan COMPONENTS glslc REQUIRED)

set(TARGET vulkan-shaders-gen)
add_executable(${TARGET} vulkan-shaders-gen.cpp)
install(TARGETS ${TARGET} RUNTIME)
target_compile_features(${TARGET} PRIVATE cxx_std_17)
target_link_libraries(vulkan-shaders-gen PUBLIC Threads::Threads)
target_link_libraries(vulkan-shaders-gen PRIVATE Vulkan::Vulkan)

# Local windows-gnu fix (see workhub .claude/rules/voice-input-build.md):
# vulkan-shaders-gen runs on the build host during the build. Linked
# dynamically, it loads whichever libstdc++-6.dll comes first on PATH —
# on machines where Git's older mingw64 shadows the real toolchain this
# dies with STATUS_ENTRYPOINT_NOT_FOUND. Static linking sidesteps PATH.
if (WIN32 AND CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
    target_link_options(${TARGET} PRIVATE -static)
endif()
