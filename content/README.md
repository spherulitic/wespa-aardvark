# WESPA player rating timeline

Files:

- `player.html` — complete player profile page with the rating-history section.
- `player.js` — fetches WESPA API v2 data, renders the graph and tournament table.
- The graph uses the official `endRating` and `ratingChange` values returned by:
  `/api/v2/player/{player_id}`.
- Starting rating is displayed as `endRating - ratingChange`.
- No Glicko rating calculation is performed in the browser.

## Deployment

Place `player.html` and `player.js` in the same web directory.

The default API base is:

```text
/api
```

This matches the existing WESPA nginx reverse-proxy arrangement.

Open a profile as:

```text
player.html?id=757
```

If hosting elsewhere, define an API base before loading `player.js`:

```html
<script>
  window.WESPA_API_BASE = "https://your-api-host.example/api";
</script>
<script src="player.js" defer></script>
```

The API host must allow the page origin through CORS when the page and API are on
different domains.
