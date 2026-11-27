# Release legal checklist

What has to be true before Eaglets Code goes to the public. This isn't legal advice. If you sell kits or sign contracts with schools, get a lawyer to look over the hardware and contract items.

## Done in the app

- [x] **Project licence.** MIT, © 2026 Eaglets (`LICENSE`, `"license": "MIT"` in package.json, copyright in the installers).
- [x] **Third-party licences.** Blockly and its field plugins (Apache-2.0), React, CodeMirror and Lezer (MIT), and the Fredoka font (OFL-1.1) all require their notices to ship with the app. The minified bundle strips them, so `npm run notices` collects them into `THIRD_PARTY_NOTICES.txt`, which ships in the app and next to the installers. Electron and Chromium licences are added by electron-builder. `tests/notices.test.ts` fails if a new import isn't covered.
- [x] **Privacy policy** (`PRIVACY.md`, summary in More → About & privacy). It covers COPPA, GDPR / UK GDPR and the UK Children's Code, and those laws are easy to meet here because the app processes no personal data.
- [x] **The "collects nothing" claim is enforced.** Blockly's sprites load locally instead of from static.blockly.com, Electron's spellchecker is off (it can download dictionaries from Google), the font is bundled rather than loaded from Google Fonts, and the e2e test fails on any request to another origin.
- [x] **Warranty disclaimer and safety notice** in the About dialog and the licence.
- [x] **No borrowed branding.** The Vite template leftovers are removed (Vite logo favicon, Bluesky/Discord/GitHub/X icon sprite, React/Vite logos).

## Still to do (needs you)

### Before any public release
- [ ] **Test on real hardware.** `docs/HARDWARE-STATUS.md` says the app has never driven a real robot, and the USB-pull motor stop is only tested on fakes. Shipping robot-control software for children that hasn't run on real hardware is the biggest liability risk on this list. A licence disclaimer doesn't cover a child's injury.
- [ ] **Check the name "Eaglets".** Search USPTO (and EUIPO/UKIPO if you sell abroad) for "Eaglets" in class 9 (software) and class 28 (toys), so you don't build a brand on a name someone else owns.
- [ ] **Decide whether the GitHub repo goes public.** MIT only means something once people can get the code. Before making it public, check the git history for secrets or personal photos.
- [ ] **Keep "Raspberry Pi" and "MicroPython" as plain compatibility statements** ("for the Raspberry Pi Pico 2"), never in the product name or logo. That's what the app does today.

### Distribution
- [ ] **macOS: Apple Developer ID + notarization** (US$99/yr). Without it, Gatekeeper warns or blocks, and many schools' managed Macs won't open the app at all. In package.json, set `mac.identity` to your Developer ID, set `hardenedRuntime: true`, and add `notarize`.
- [ ] **Windows: code-signing certificate** (OV or EV, or Azure Trusted Signing). Without one, SmartScreen shows "Windows protected your PC".
- [ ] **Mac App Store or Microsoft Store, if you want them.** Both need the privacy policy at a public URL (host `PRIVACY.md`, e.g. on GitHub Pages) and a privacy label ("Data Not Collected"). The Mac App Store also needs sandboxing and USB-serial entitlements, which is extra work.
- [ ] **If you host the web version,** say in a sentence on the site that the host (e.g. GitHub Pages) keeps standard server logs. `PRIVACY.md` already covers this in general terms.

### Schools
- [ ] **Accessibility.** US public schools must meet WCAG 2.1 AA under the 2024 ADA Title II rule, and many districts will ask for a VPAT/ACR. Block editors are hard to make fully accessible. Do an audit and publish an honest accessibility statement.
- [ ] **Student-data privacy agreements.** Districts often ask vendors to sign one (e.g. the Student Data Privacy Consortium's NDPA). Since the app collects nothing these are easy, but someone has to sign them.

### If you sell the robot kit (hardware, outside this app)
- [ ] **US:** a toy for under-13s is a "children's product". It needs third-party testing to ASTM F963 and CPSIA, a Children's Product Certificate, tracking labels and small-parts warnings, plus FCC Part 15 for the electronics.
- [ ] **EU/UK:** CE/UKCA marking under the Toy Safety Regulation (EN 71), EMC and RoHS, plus WEEE and battery-regulation labelling.
- [ ] **Battery shipping rules** for lithium cells.
- [ ] **Product-liability insurance.** Worth having before selling anything with motors to children.

## Every release

- [ ] `npm run build` (regenerates the notices), `npm test`, `npm run test:e2e`. All must pass, including "no requests to third-party servers".
- [ ] If the app ever starts collecting data or adds online features, update `PRIVACY.md` **first**. Collecting personal data from under-13s needs verifiable parental consent (COPPA).
- [ ] Bump the version in package.json. The About dialog shows it.
