# prepMASTER — Cloud Sync Edition

This version keeps the prepMASTER dashboard local-first and supports Google sign-in plus phone-number OTP sign-in/linking with private cloud sync.

## How cross-device sync works
- GitHub Pages hosts the website files.
- Firebase Authentication identifies the same Google account on laptop and mobile.
- Cloud Firestore stores that account's saved study sessions and settings.
- Sign in with the same Google account on both devices. The saved session history and JEE target / Pomodoro settings sync to both.
- Local browser storage remains as a local cache.

The currently running stopwatch/Pomodoro second-by-second state stays on the device where it was started. A stopwatch session syncs when you finish and save it; a completed focus Pomodoro syncs automatically.

## One-time setup

### A. Create Firebase project
1. Open https://console.firebase.google.com/ and create a project.
2. Add a Web App in Project settings and copy its Firebase config.
3. In Authentication → Sign-in method, enable **Google** and **Phone**.
4. In Authentication → Settings → Authorized domains, add your GitHub Pages domain, for example `your-username.github.io`.
5. In Authentication → Settings → SMS region policy, allow the country/region you intend to send OTPs to (for India, allow India).
6. In Firestore Database, create a database.

### B. Add the Firebase config
1. Open `app.js`.
2. Replace the `PASTE_...` placeholders in `firebaseConfig` with the values from your Firebase Web App configuration.
3. Save the file.

The Firebase Web App config is intended to be used in browser applications. Do not put service-account keys or other private admin credentials in website code.

### C. Set Firestore security rules
In Firebase Console → Firestore Database → Rules, paste the contents of `firestore.rules` and publish.

These rules restrict each signed-in user to their own `/users/{uid}/...` data.

### D. Publish on GitHub Pages
1. Upload the files in this folder to your GitHub repository.
2. In repository Settings → Pages, choose the branch and root folder, then save.
3. Open the published `https://...github.io/...` website on laptop.
4. Click **Connect Google to sync** and sign in.
5. Open the same website on mobile and sign in with the same Google account.

On first connection, local sessions from that browser are copied into that account's cloud history. On another device, the cloud history is loaded automatically after sign-in.

## Free-tier notes
Firebase Spark includes no-cost Firestore quotas. Current Firestore free quota documentation lists 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, and 10 GiB/month outbound transfer. Staying within the quota keeps this small personal tracker within the no-cost tier. Check Firebase's current pricing/quota pages before scaling.

## If the sync button does not work
- Make sure Google sign-in is enabled in Firebase Authentication.
- Confirm your GitHub Pages domain is in Firebase Authorized domains.
- Confirm Firestore database exists and the security rules have been published.
- Confirm you replaced all config placeholders in `app.js`.
- Open the website over HTTPS via GitHub Pages, not from a local `file://` path.

## Privacy / GitHub clarification
GitHub Pages publishes the website code; it is not the private database for your study records. The app intentionally stores study data in Firebase Firestore, not in a public GitHub repository. Never paste a GitHub personal access token into `app.js` or other browser code.


## Phone authentication notes
- Web phone authentication requires Firebase reCAPTCHA and the hosted domain must be in Authentication → Settings → Authorized domains.
- Enter an Indian 10-digit number or an international number in E.164 format (for example `+91...`).
- Firebase's current phone-auth setup requires an SMS region policy; new projects can initially allow no regions.
- Firebase states that live SMS phone authentication requires a Cloud Billing account since September 2024. Do not enable billing just to test without checking the costs and getting the account owner's approval. Use Firebase's fictional test phone numbers/codes during development; test codes do not send real SMS.
- Phone number sign-in is less secure than Google sign-in because phone numbers can be transferred. Keep Google sign-in available as a stronger alternative.
- If a phone number is already attached to another Firebase user, Firebase will not automatically merge that account's data into the Google account. Sign in to the existing identity and handle any account migration deliberately.


## Install prepMASTER on Android (no APK required)
This package is a Progressive Web App (PWA). After uploading these updated files and the `icons` folder to the root of the GitHub repository:
1. Wait for GitHub Pages to publish the update.
2. Open `https://dailyinspiring.github.io/prepMASTER/` in Chrome on Android.
3. Tap Chrome's three-dot menu.
4. Choose **Install app** or **Install and create shortcut**, then confirm.
5. prepMASTER appears on the Android home screen and opens in an app-like standalone window.

The PWA needs to be served over HTTPS. On this GitHub Pages address it is HTTPS.
The app still requires an internet connection for Firebase account login and cloud sync.

## If you specifically need an APK file
After the PWA version is deployed, you can use PWABuilder to package its HTTPS URL as an Android Trusted Web Activity (TWA). PWABuilder currently documents Android packaging through Bubblewrap. An APK can be generated for testing; publishing through Google Play requires a signed app bundle and a Play developer account. See:
- https://www.pwabuilder.com/
- https://github.com/pwa-builder/PWABuilder/blob/main/docs/builder/android.md

This ZIP makes the website PWA-ready; it is not itself an `.apk` file.
