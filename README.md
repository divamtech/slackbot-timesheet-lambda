# slackboot-timesheet

## local running

```
cp .env.example .env #update the env
npm i
npm run dev
ngrok http 3000 # put this url to slack app with appending this {url}/slack/interactions
```

Can run on lambda if env `AWS_LAMBDA_FUNCTION_NAME` has some value. then cronjob won't run. need to add event bridge.
