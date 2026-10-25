# Lunch Spy 🕶️

A phone-first social deduction game for 3–10 friends, set in a school cafeteria.

## Run it

```
npm install
npm start
```

Open the "On your Wi-Fi" link the server prints on every phone connected to the same Wi-Fi.
If Windows Firewall asks, allow Node.js on private networks.

## Play over the internet (free)

Vercel can't run the game server, because it needs a long-lived WebSocket connection.
So the game server goes on Render, and the website can go on Vercel.

1. Put this folder in a GitHub repo. `node_modules` is already ignored.
2. On https://render.com choose **New > Blueprint** and pick the repo. `render.yaml` sets everything up.
3. Copy the server URL Render gives you, like `https://lunch-spy.onrender.com`.
4. Paste it into `public/config.js` as `window.LUNCH_SPY_SERVER`, then commit and push.
5. On https://vercel.com choose **Add New > Project** and import the same repo. `vercel.json` handles the build.
6. Optional: on Render, set the `CORS_ORIGIN` env var to your Vercel URL so only your site can connect.

Skipping Vercel also works. The Render URL serves the whole game by itself if `config.js` stays empty.
Free Render servers sleep when idle, so the first visit takes about 30 seconds to wake up.

## Rules

- 1 spy for 3–6 players, 2 spies for 7–10 players.
- Students finish their lunch list. Spies do secret missions that look exactly like normal tasks.
- Mission alerts appear 3–10 seconds after the mission is done.
- Chat bubbles only reach players close to you.
- Ring the bell in the middle of the hall to call a meeting. Each player can ring it once.
- Most votes goes to detention and becomes a ghost. Ties and skips eject nobody.

## Look and feel

The UI is "Y2K digital nostalgia": Win95 windows, LCD readouts, a Nokia-style phone and pixel stickers.

- `public/tokens.css` holds every color, font, bevel size and effect strength. Re-theme here.
- `public/ui.css` holds the reusable components, like windows, buttons, LCD panels, pills and sliders.
- `public/retro.js` holds the Window component, pixel sprites, dialogs, menus, film grain and settings.
- Three themes ship: Classic 95, Green LCD and Bitmap. Players switch in Settings.

## Tweak it

Game numbers are at the top of `server.js`, like task time, meeting length and tasks per player.
The map, stations and missions live in `shared/map.js`.

Desktop controls: WASD to move, E to use, B for the bell, Enter to chat, M for the map.
