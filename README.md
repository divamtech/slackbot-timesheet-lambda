# slackboot-timesheet-lambda

## local running

```
cp .env.example .env #update the env
npm i
npm run dev
ngrok http 3000 # put this url to slack app with appending this {url}/slack/interactions
```

FIX this query

```sql
SELECT users.*
    FROM users
    LEFT JOIN timesheets t
    ON users.slack_id = t.user_slack_id AND DATE(t.created_at) = CURDATE()
    WHERE users.is_active = 1
```
