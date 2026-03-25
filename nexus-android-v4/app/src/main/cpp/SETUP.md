# llama.cpp NDK Build Setup

This directory should contain the llama.cpp source code for the Android NDK build.

## Setup

Clone llama.cpp into this directory:

```bash
cd nexus-android-v4/app/src/main/cpp/
git clone https://github.com/ggerganov/llama.cpp
```

The CMakeLists.txt in the parent directory expects `llama.cpp/` to be present here.

## Build

Once llama.cpp is cloned, build the Android app normally:

```bash
cd nexus-android-v4
./gradlew assembleDebug
```

The NDK build will compile llama.cpp as a shared library (`libllama.so`) for `arm64-v8a`.

## Requirements

- Android NDK 27+
- CMake 3.22+
- Android SDK 35
