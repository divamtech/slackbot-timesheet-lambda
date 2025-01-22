const express = require('express')
require('dotenv').config()
const bodyParser = require('body-parser')
const mysql = require('mysql2/promise')
const { WebClient } = require('@slack/web-api')

const app = express()
const port = process.env.PORT || 3000

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_NAME,
})

// Slack Web API Client
const web = new WebClient(process.env.SLACK_BOT_TOKEN)

// Middleware
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

// Endpoint
app.get('/send-reminders', async (req, res) => {
  try {
    await sendReminderWithButton()
    res.send('Reminders sent successfully!')
  } catch (error) {
    console.error('Error sending reminders:', error)
    res.status(500).send('Failed to send reminders')
  }
})

app.get('/sync-users', async (req, res) => {
  try {
    const response = await web.users.list()
    console.log('response---------------------', response)
    const users = response.members.filter((user) => !user.is_bot && !user.deleted)

    const [rows] = await db.query('SELECT * FROM users')
    //save to database

    const newUsers = users
      .filter((user) => {
        if (user.id == 'USLACKBOT') {
          return false
        } else if (rows.some((u) => u.slack_id == user.id)) {
          return false
        }
        return true
      })
      .map((user) => ({
        email: user.name,
        name: user.real_name,
        slack_id: user.id,
        is_active: false,
      }))

    //insert new users into db
    if (newUsers.length > 0) {
      const values = newUsers.map((user) => [user.email, user.name, user.slack_id, user.is_active])
      await db.query('INSERT INTO users (email, name, slack_id, is_active) VALUES ?', [values])
    }

    res.send('Users synced')
  } catch (error) {
    console.error('Error sync users:', error)
    res.status(500).send('Failed to sync users: ' + JSON.stringify(error))
  }
})

// Endpoint to handle Slack interactions
app.post('/slack/interactions', async (req, res) => {
  const payload = JSON.parse(req.body.payload)

  try {
    if (payload.type === 'block_actions' && payload.actions[0].action_id === 'open_timesheet_modal') {
      await handleButtonClick(res, payload)
    } else if (payload.type === 'view_submission' && payload.view.callback_id === 'submit_timesheet') {
      await handleModalResponse(res, payload)
    } else {
      console.log('unable to understand the action:', payload)
      res.status(500).send('unable to understand the action')
      return
    }
  } catch (error) {
    console.error('unable to understand the action with errors:', error)
    res.status(500).send('unable to understand the action with errors')
  }
})

//handlers
async function sendReminderWithButton() {
  const [definedUsers] = await db.query(`
        SELECT DISTINCT users.* FROM users
        WHERE users.is_active = 1
        AND users.slack_id NOT IN (
            SELECT t.user_slack_id
            FROM timesheets t
            WHERE DATE(t.created_at) = CURDATE()
        )
      `)

  for (const user of definedUsers) {
    try {
      await web.chat.postMessage({
        channel: user.slack_id,
        text: 'Please fill out your timesheet!',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Hi, please fill out your daily task details by clicking the button below:',
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Fill Timesheet',
                  emoji: true,
                },
                action_id: 'open_timesheet_modal', // Action triggers the modal
              },
            ],
          },
        ],
      })
      console.log(`Reminder sent to user ${user.slack_id}`)
    } catch (error) {
      console.error(`Error sending reminder to user ${user.slack_id}:`, error)
    }
  }
}

async function handleButtonClick(res, payload) {
  if (!(await canUserSubmit(payload.user.id))) {
    res.sendStatus(200)
    return
  }

  try {
    await web.views.open({
      trigger_id: payload.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'submit_timesheet',
        title: {
          type: 'plain_text',
          text: 'Timesheet',
        },
        blocks: [
          {
            type: 'input',
            block_id: 'timesheet_details',
            element: {
              type: 'plain_text_input',
              multiline: true,
              action_id: 'input_timesheet',
            },
            label: {
              type: 'plain_text',
              text: 'Enter your daily task details:',
            },
          },
        ],
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
      },
    })
    res.sendStatus(200)
  } catch (error) {
    console.error('Error opening modal:', error)
    res.status(500).send('Failed to open modal')
  }
}

async function handleModalResponse(res, payload) {
  if (!(await canUserSubmit(payload.user.id))) {
    res.send({ response_action: 'clear' }) // Clears the modal
    return
  }

  const userInput = payload.view.state.values.timesheet_details.input_timesheet.value

  // Simulating posting to an endpoint
  try {
    console.log(`Timesheet input from user ${payload.user.id}:`, userInput)
    console.log('Payload:', {
      user: payload.user.id,
      timesheet: userInput,
    })

    // insert data into timesheet table, get the column with created_at date
    const [result] = await db.query('INSERT INTO timesheets (user_slack_id, task_details) VALUES (?, ?)', [payload.user.id, userInput])
    const [row] = await db.query('SELECT * FROM timesheets WHERE id = ?', [result.insertId])

    console.log('Row inserted:', row)
    res.send({ response_action: 'clear' }) // Clears the modal
    await web.chat.postMessage({
      channel: payload.user.id,
      text: `Thank you for submitting your timesheet! [id: ${row[0].id}, time: ${row[0].created_at}]`,
    })
  } catch (error) {
    console.error('Error handling timesheet submission:', error)
    res.status(500).send('Failed to handle timesheet submission')
  }
}

async function canUserSubmit(userSlackId) {
  if (new Date().getHours() >= 20) {
    await web.chat.postMessage({
      channel: userSlackId,
      text: 'You cannot fill the timesheet, time exceeded, you can fill this till 8PM!',
    })
    return false
  }

  const [row] = await db.query(
    `
    SELECT timesheets.*
      FROM timesheets
      INNER JOIN users
      ON users.slack_id = timesheets.user_slack_id
      WHERE users.is_active = 1 
      AND timesheets.user_slack_id = ?
      AND DATE(timesheets.created_at) = CURDATE();
`,
    [userSlackId],
  )

  if (row.length > 0) {
    await web.chat.postMessage({
      channel: userSlackId,
      text: `You already filled the timesheet, thankyou! [id: ${row[0].id}, time: ${row[0].created_at}]`,
    })
    return false
  }
  return true
}

// Start the server
app.listen(port, () => {
  console.log(`Slack app listening at http://localhost:${port}`)
})

//RUNNING the main engine.
if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
  //lambda handling
  const serverless = require('serverless-http')
  const handler = serverless(app)

  exports.handler = async (event, context, callback) => {
    const response = handler(event, context, callback)
    return response
  }
} else {
  // Run the cron job
  const cron = require('node-cron')
  cron.schedule('30 18 * * 1-5', sendReminderWithButton, { timezone: 'Asia/Kolkata' }) //6:30PM
  cron.schedule('45 18 * * 1-5', sendReminderWithButton, { timezone: 'Asia/Kolkata' }) //6:45PM
  cron.schedule('0 19 * * 1-5', sendReminderWithButton, { timezone: 'Asia/Kolkata' }) //7:00PM
}
