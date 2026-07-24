# SaveNet

[SaveNet](https://savenet.am1.tech) is an AI-powered, searchable library for posts and links a user saves across social media (Instagram and X for now), browser bookmarks, and reading list items. 

## SaveNet Extension

This repository holds the code for the [extension](https://chromewebstore.google.com/detail/savenet-save-smarter-find/kmbfnbpogmgfmlohnajkpmeicocpedof) that captures post save events and conducts imports of items from existing collections (Instagram saved posts collections, browser bookmarks, reading lists). The code for the web app can be found [here](https://www.github.com/hrmtsh2/savenet-web).

The extension captures - 

- Instagram posts and reels - new (as and when you save them), or from an existing collection
- X Bookmarks
- Browser Bookmarks - new, or from an existing bookmarks folder
- Read List Item - new, or previously saved

Captured items keep their source URL, author details where available, text, capture time, and source context.
Failed captures are queued in browser storage and retried later by user.

### How it works

The extension uses AWS Cognito's PKCE login flow, then exchanges the result for an opaque SaveNet session token.
That token is used only to send captures to the web app.

Platform-specific content scripts detect a save or bookmark and build a common post payload.
The background service worker sends it to SaveNet, handles retries, manages bookmark and Reading List imports, and keeps the popup up to date.

## Permissions

The extension requests the following permissions, needed for these features:

- `storage` for the login state, capture queue, and local capture log
- `identity` for Cognito sign-in and sign-out
- `tabs` to identify the active Instagram collection page
- `bookmarks` for browser bookmark capture and folder imports
- `readingList` for Chrome Reading List capture and imports

Its site access is limited to Instagram, X/Twitter, SaveNet, localhost for development, and the Cognito Chrome redirect URI.

## Project structure

```text
background.js    intra-extension messaging, authentication, unsaved post queueing
common.js        helpers for making payloads from posts scraped by content scripts
instagram.js     Instagram save detection and collection import
x.js             X bookmark detection
popup.html/js    extension popup and import controls
manifest.json    configuration, permissions
```
