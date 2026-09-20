# Amity Integration Helper

This Manifest V3 Chrome extension connects supported services to Amity through the user's signed-in browser session. For LinkedIn, it reads connection previews in the LinkedIn tab and passes only those previews to Amity. It does not send the LinkedIn password or session cookie to Amity's frontend or backend.

## Local installation

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this directory.
4. Open Amity at `http://localhost:3000`, then click **Connect** on LinkedIn Contacts.

If LinkedIn asks for a login, finish signing in in that tab and click **Connect** again.
