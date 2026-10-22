# Browser password lock

Every HTML entry page loads `site-access.js` synchronously at the start of its
head, before any app scripts or resources. Locked pages keep the remaining
markup in an inert template and redirect to `password.html`. Successful entry
returns to the original page, including its query string and hash.

The password is `0123` (no trailing space). Access is remembered in localStorage,
scoped to this project's URL path, with no application expiry. Each browser or
browser profile needs to be unlocked once. Clearing site data, private browsing,
or changing the site's origin/path can require entering the password again.
Browsers must permit localStorage. No password is saved in browser storage.

This is only a basic browser lock. The password and all static source files are
publicly downloadable, and a visitor can bypass the lock using developer tools.
It does not protect Firebase: the existing apps still use anonymous Firebase
authentication, and database access is governed by the deployed Firebase rules.
Strict access control requires server/hosting authentication and corresponding
Firebase authorization rules.

When adding a new HTML page, copy the style and synchronous `site-access.js`
script from the beginning of an existing page's head, adjusting the relative
script path for its directory. Keep them before all app scripts and resources.
Do not add the guard to `password.html`, which loads the script with `defer`.

To forget this browser's access, remove its `timetable-hub:access:…:v1`
localStorage entry. Increment the storage key version in `site-access.js` to
ask all browsers for the password again after a change.

Validation: run `node tests/browser-lock.cjs` with Playwright available to Node
and Microsoft Edge installed. The test uses a local server and temporary browser
profiles, blocks external requests, and checks all entry pages, wrong passwords,
remembered access after restart, return URLs, mobile layout, unavailable storage,
and JavaScript-disabled visibility. It does not write to Firebase. Browsers may
speculatively request static assets while a locked page is redirecting; app
scripts remain inactive.
