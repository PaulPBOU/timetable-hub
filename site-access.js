// A convenience lock for this static site, not server-side authentication.
(() => {
    'use strict';

    const root = new URL('.', document.currentScript.src);
    const login = new URL('password.html', root);
    // Scope access to this project, since GitHub Pages projects share an origin.
    const storageKey = `timetable-hub:access:${root.pathname}:v1`;
    const accessValue = 'unlocked';
    const isLogin = location.pathname === login.pathname;

    function hasAccess() {
        try {
            return localStorage.getItem(storageKey) === accessValue;
        } catch {
            return false;
        }
    }

    function destination() {
        const requested = new URLSearchParams(location.search).get('return');
        try {
            const target = new URL(requested || 'index.html', root);
            if (target.origin === root.origin && target.pathname.startsWith(root.pathname)
                && target.pathname !== login.pathname) {
                return target.href;
            }
        } catch { /* Invalid destinations return to the home page. */ }
        return new URL('index.html', root).href;
    }

    if (!isLogin) {
        if (hasAccess()) {
            document.documentElement.setAttribute('data-site-unlocked', '');
            return;
        }

        // This script must stay synchronous and first in each page's head.
        // Keep the rest of the document inert so its app scripts cannot run
        // or connect to Firebase while the browser navigates to the lock.
        document.write('<template data-site-locked>');
        login.searchParams.set('return', location.href);
        location.replace(login.href);
        return;
    }

    if (hasAccess()) {
        location.replace(destination());
        return;
    }

    const form = document.getElementById('password-form');
    const password = document.getElementById('password');
    const error = document.getElementById('password-error');

    password.addEventListener('input', () => {
        password.removeAttribute('aria-invalid');
        error.textContent = '';
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (password.value !== '0123') {
            error.textContent = 'Incorrect password. Try again.';
            password.setAttribute('aria-invalid', 'true');
            password.focus();
            password.select();
            return;
        }

        try {
            localStorage.setItem(storageKey, accessValue);
            if (!hasAccess()) throw new Error('Storage unavailable');
        } catch {
            error.textContent = 'Allow this site to save browser data, then try again.';
            return;
        }

        location.replace(destination());
    });
})();
