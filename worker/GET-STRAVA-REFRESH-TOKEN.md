# Getting the Strava refresh token, once

The app never does Strava OAuth in the browser — it can't. You do the exchange
once by hand, store the resulting refresh token as a Worker secret, and the
Worker mints access tokens from it forever after.

You need the **Client ID** and **Client Secret** from your "Hayden's Trainer" app
at <https://www.strava.com/settings/api>.

Set the app's **Authorization Callback Domain** to `localhost`.

## 1. Authorise

Open this in a browser, with your client ID substituted in:

```
https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http://localhost/exchange_token&approval_prompt=force&scope=activity:read_all
```

Click Authorize. The browser will fail to load `localhost` — that is expected.
Copy the `code` value out of the address bar:

```
http://localhost/exchange_token?state=&code=THIS_PART_HERE&scope=read,activity:read_all
```

## 2. Exchange the code for a refresh token

```sh
curl -X POST https://www.strava.com/oauth/token \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d code=THE_CODE_FROM_STEP_1 \
  -d grant_type=authorization_code
```

The response contains `refresh_token`. That is the value you want. It does not
expire unless you revoke the app.

## 3. Store the secrets

From the `worker/` directory:

```sh
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REFRESH_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
```

Each prompts for the value and stores it encrypted on Cloudflare. None of them
ever appear in this repository.

## 4. Check it

```sh
curl https://haydens-trainer-proxy.YOUR-SUBDOMAIN.workers.dev/health
```

Expect `{"ok":true,"strava":true,"claude":true}`.

The `scope=activity:read_all` matters — plain `activity:read` omits activities
you have marked private, which will silently under-count your week.
