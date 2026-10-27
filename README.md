# 🛡️ DUH Torn Watcher

**A browser extension for Torn City players who want to keep an eye on faction activity, Xanax usage, and valuable bazaar listings.**

DUH Torn Watcher monitors important in-game events and alerts you through browser popups and audio alarms, helping you stay informed without constantly checking Torn manually.

## ✨ Features

### 🚨 1. Faction Attack Alerts

Keep track of what's happening to your faction members.

- Get alerted when a faction member is **attacked**.
- Get alerted when a faction member is **mugged**.
- Get alerted when a faction member is **hospitalized**.
- Receive popup notifications and audio alarms when matching activity is detected.

Useful for monitoring faction activity and responding quickly when members are under attack.

### 💊 2. Xanax Usage Monitoring

Monitor Xanax usage to help keep track of activity and faction rules.

- Receive alerts when someone uses Xanax.
- Monitor Xanax consumption across the activity the extension can detect.
- Useful for factions that restrict Xanax usage to **chains or ranked wars**.
- Helps faction leaders and members keep track of relevant activity.

### 💰 3. Weav3r Daller Bazaar Alerts

Watch for potentially valuable bazaar listings on Weav3r Daller.

- Monitor bazaar listings for items priced at **$1**.
- Get alerted when the total value of qualifying $1 listings exceeds your configured threshold.
- Default example: alert when qualifying items are worth more than **$1,000,000** in total.
- Customize the threshold to suit your needs.
- Receive popup notifications and audio alarms when a matching bazaar is detected.

Useful for spotting potentially valuable listings that might otherwise be easy to miss.

## 🔔 Notifications

DUH Torn Watcher uses two notification methods:

- **Browser popups** — see alerts while browsing.
- **Audio alarms** — hear an alert when matching activity is detected.

Notifications help you notice important events without keeping the Torn page constantly in focus.

## 🔑 Torn API Key

The extension uses a **Torn API key with Limited permissions** to access the information required for its monitoring features.

For your security:

- Use a Limited-permission API key rather than granting unnecessary permissions.
- Your API key is stored and used locally by the browser extension.
- Your API key is not shared with other users.
- Monitoring data stays in your browser and is not intentionally sent to an external server by the extension.

**Security recommendation:** Only install extensions you trust, and review the extension's source code before entering your API key.

## 🔒 Privacy

DUH Torn Watcher is designed to keep your data local.

- No account password is required.
- No API key is shared with other users.
- Monitoring data stays in your browser.
- The extension uses your API key to retrieve the information required for its features.

Your API key is sensitive. Never share it in screenshots, bug reports, or public GitHub issues.

## ⚙️ Configuration

Configure the extension to match your monitoring needs.

Depending on the available settings, you can adjust:

- Torn API key.
- Bazaar alert threshold.
- Notification and audio alert preferences.

For example, you can set the bazaar alert threshold to **$1,000,000** or choose another amount that better suits your needs.

## 📦 Installation

### Install from source

1. Download or clone this repository.
2. Extract the files if you downloaded a ZIP archive.
3. Open your browser's extension management page.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extension's source folder containing its manifest file.
7. Open the extension and configure your Torn API key and preferences.

The exact steps may vary depending on your browser.

## ⚠️ Important Notes

- Alerts depend on the information available through Torn's API and the extension's monitoring logic.
- Notifications may be delayed by polling intervals, API limits, browser activity, or network issues.
- Audio alerts may require browser permission or user interaction to work.
- Bazaar alerts depend on the listings and pricing information available to the extension.
- A Limited API key only provides access to the endpoints permitted by Torn's API.

DUH Torn Watcher is a community utility and is not an official Torn City product.

## 🧰 Built For

- Torn City faction leaders and members.
- Players monitoring faction attacks and hospitalizations.
- Factions tracking Xanax usage during chains and ranked wars.
- Players watching for valuable $1 bazaar listings.

## 📜 License

Check the repository for license information before redistributing or modifying this project.

---

**Stay alert. Watch your faction. Keep an eye on the market.**

*DUH Torn Watcher — useful alerts for Torn City players.*