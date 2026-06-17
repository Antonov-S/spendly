# Profile Page

## Overview

Create the profile page with user info, stats, change password and delete account.

## Requirements

- Create profile page at `/profile` route
- Display user info: email, name, avatar (Google or initials), account creation date
- Show usage stats breakdown by item type
- Add account actions: change password (email users only), delete account with confirmation
- Follow existing codebase patterns for data fetching and components

## Notes

- Avatar logic: Use Google avatar from OAuth if available, otherwise generate initials from name/email
- Change password button should only appear for users who signed up with email/password (not Google OAuth)
- Delete account needs confirmation dialog to prevent accidental deletion
- Item type breakdown should show counts for each
- Route should be protected (require authentication)
- Use modern Accessible HTML practices, Modern NextJs practices, Modern React Components practices, Modern Browser APIs practices, Modern Tailwind practices

```

```
