# Contributing to QpiAI Nexus

Thank you for your interest in contributing to Nexus! This document provides guidelines for contributing to the project.

## Development Environment Setup

### Web Platform

```bash
cd llm-integration-platform
npm install
cp .env.example .env.local    # Add your API keys
npm run dev                    # Starts on http://localhost:6001
```

**Requirements:** Node.js 18+, Python 3.10+

### Python Venvs (for quantization/inference)

Python scripts use isolated package directories. To set up:

```bash
cd llm-integration-platform
bash scripts/setup_all_venvs.sh    # Requires uv (https://docs.astral.sh/uv/)
```

Or manually install packages with `pip install --target=venvs/<method>/lib/python3.x/site-packages`.

### Android (v4)

```bash
cd nexus-android-v4/app/src/main/cpp
git clone https://github.com/ggerganov/llama.cpp
cd ../../../../..
./gradlew assembleDebug
```

**Requirements:** Android Studio, SDK 35, NDK 27, CMake

### iOS/macOS

```bash
open nexus-ios/NexusApp/NexusApp.xcodeproj
```

**Requirements:** macOS, Xcode 15+, Apple Silicon (for MLX inference)

### Electron Desktop

```bash
cd nexus-desktop
npm install
npm start
```

**Requirements:** Node.js 18+

### Flutter

```bash
cd nexus_mobile
flutter pub get
flutter run
```

**Requirements:** Flutter SDK 3.16+, Dart 3.2+

## Running Tests

### Web Platform

```bash
cd llm-integration-platform
npm test                                    # All tests
npx jest __tests__/utils.test.ts            # Single file
npx jest --testNamePattern="formatBytes"    # By name
```

### Linting

```bash
cd llm-integration-platform
npm run lint
```

## Code Style

- **TypeScript/React**: Follow existing patterns. Use `@/` path alias for imports from `src/`.
- **Styling**: Tailwind CSS with CSS custom properties for theming.
- **Python**: Follow PEP 8. Scripts emit JSON lines to stdout for SSE streaming.
- **Kotlin**: Follow standard Android/Kotlin conventions.
- **Swift**: Follow Swift 6 conventions.

## Pull Request Process

1. Fork the repository and create a feature branch.
2. Make your changes, ensuring tests pass.
3. Write clear commit messages describing the change.
4. Submit a pull request with:
   - A description of what changed and why
   - Any relevant issue numbers
   - Screenshots for UI changes
5. Address review feedback.

## What to Contribute

- Bug fixes
- Performance improvements
- New quantization method support
- Client app improvements
- Documentation improvements
- Test coverage

## License

By contributing to QpiAI Nexus, you agree that your contributions will be licensed under the Apache License 2.0.
