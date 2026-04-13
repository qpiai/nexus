# 🤝 Contributing to QpiAI Nexus

**Thank you for being here — you're about to help democratize AI.**

Nexus is built by and for people who want real AI to run on real devices, from cloud GPUs to the phones in our pockets. Every contribution, big or small, brings that future a little closer.

---

## 💡 Why contribute?

- 🌍 **Real impact** — Nexus is open-source and runs on iOS, Android, desktop, and servers. Your code reaches people everywhere.
- 🎯 **Mission you can believe in** — *democratize AI, empower every device*
- 🧪 **Edge-of-the-field work** — quantization, on-device inference, agent systems, vision fine-tuning
- 👥 **Friendly community** — we review PRs promptly and are happy to help first-timers

---

## 🌱 Good first contributions

If you're new, any of these are a great start:

- 🐛 Fix a bug from [Issues](https://github.com/qpiai/nexus/issues) — look for `good first issue`
- 📝 Improve the docs — typos, clarity, a missing step
- 🧪 Add a test for an untested path
- 🎨 Polish a UI detail — spacing, color, a small UX win
- 🧩 Add a new model to the catalog

Tiny PRs are genuinely welcome. Drive-by doc fixes count too.

---

## 🛠️ Development Setup

### 🌐 Web Platform

```bash
cd llm-integration-platform
npm install
cp .env.example .env.local      # add your API keys
npm run dev                     # http://localhost:6001
```

Needs: Node.js 18+, Python 3.10+

---

### 🐍 Python Environments

Quantization needs isolated venvs because each method pins different package versions.

```bash
cd llm-integration-platform
bash scripts/setup_all_venvs.sh   # with uv — fastest
```

Or pip-based: `pip install --target=venvs/<method>/lib/python3.x/site-packages <pkg>`

---

### 🤖 Android (v7)

```bash
cd nexus-android-v7/app/src/main/cpp
git clone https://github.com/ggerganov/llama.cpp
cd ../../../../..
./gradlew assembleDebug
```

Needs: Android Studio, SDK 35, NDK 27, CMake

---

### 📱 iOS / macOS

```bash
open nexus-ios/NexusApp/NexusApp.xcodeproj
```

Needs: macOS, Xcode 15+, Apple Silicon (for MLX)

---

### 💻 Electron Desktop

```bash
cd nexus-desktop-v2
npm install
npm start
```

Needs: Node.js 18+

---

### 🎯 Flutter

```bash
cd nexus_mobile
flutter pub get
flutter run
```

Needs: Flutter SDK 3.16+, Dart 3.2+

---

## 🧪 Running Tests

```bash
cd llm-integration-platform
npm test                                    # all tests
npx jest __tests__/utils.test.ts            # single file
npx jest --testNamePattern="formatBytes"    # by name

npm run lint                                # ESLint
```

If you're fixing a bug, please add a test that catches it — it helps us make sure the bug stays fixed.

---

## 🎨 Code Style

We like code that's easy to read. Beyond that, follow what the surrounding file already does:

- **TypeScript / React** — use the `@/` alias for imports from `src/`
- **Styling** — Tailwind CSS with CSS custom properties for theming
- **Python** — PEP 8; scripts emit JSON lines to stdout for SSE streaming
- **Kotlin** — standard Android / Kotlin conventions
- **Swift** — Swift 6 conventions

---

## 📬 Pull Request Process

1. 🍴 Fork the repo and create a feature branch
2. ✏️ Make your changes; keep commits small and named clearly
3. ✅ Make sure tests pass (`npm test` + `npm run lint`)
4. 🚀 Open a PR with:
   - What changed and why
   - Linked issue number if any
   - Screenshots or short clips for UI changes
5. 💬 Respond to review — we'll be kind; we hope you'll be too

For bigger ideas, please open a [Discussion](https://github.com/qpiai/nexus/discussions) first so we can align early and avoid throwaway work.

---

## 💬 Questions?

- 🧵 General questions → [Discussions](https://github.com/qpiai/nexus/discussions)
- 🐞 Bug reports → [Issues](https://github.com/qpiai/nexus/issues)
- 💡 Big-idea proposals → open a Discussion before coding

---

## 📜 License

By contributing, you agree that your work is released under the [Apache License 2.0](LICENSE) — the same license as the rest of Nexus.

---

Thanks for reading all the way through. Now go build something great ❤️
