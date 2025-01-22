const express = require('express')
require('dotenv').config()
const bodyParser = require('body-parser')
const { WebClient } = require('@slack/web-api')

const app = express()
const port = process.env.PORT || 3000

// Slack Web API Client
const web = new WebClient(process.env.SLACK_BOT_TOKEN)

// Middleware
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())

// Define users for reminders, fetch this from database
const definedUsers = [
  {
    email: 'sonuy0199@gmail.com',
    name: 'Sonu Yadav',
    id: 'U07ALUCLESH',
  },
]

// Endpoint to trigger reminders
app.get('/send-reminders', async (req, res) => {
  try {
    //TODO: fetch active users from database whom timesheets are not yet submitted.
    for (const user of definedUsers) {
      await sendReminderWithButton(user.id)
    }
    res.send('Reminders sent successfully!')
  } catch (error) {
    console.error('Error sending reminders:', error)
    res.status(500).send('Failed to send reminders')
  }
})

async function sendReminderWithButton(userId) {
  try {
    await web.chat.postMessage({
      channel: userId,
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
    console.log(`Reminder sent to user ${userId}`)
  } catch (error) {
    console.error(`Error sending reminder to user ${userId}:`, error)
  }
}

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

async function handleButtonClick(res, payload) {
  //TODO: check user has already submitted the response if no then handle else return the error.
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
  //TODO: check user has already submitted the response if no then handle else return the error.

  const userInput = payload.view.state.values.timesheet_details.input_timesheet.value

  // Simulating posting to an endpoint
  try {
    //TODO: save details into the db
    console.log(`Timesheet input from user ${payload.user.id}:`, userInput)
    console.log('Payload:', {
      user: payload.user.id,
      timesheet: userInput,
    })

    // await fetch('https://inbound.divamtech.com/webhooks/blank', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     payload,
    //     user: payload.user.id,
    //     timesheet: userInput,
    //   }),
    // })
    res.send({ response_action: 'clear' }) // Clears the modal
    await web.chat.postMessage({
      channel: payload.user.id,
      text: 'Thank you for submitting your timesheet!', //TODO: add the created_at which we stored on saved row
    })
  } catch (error) {
    console.error('Error handling timesheet submission:', error)
    res.status(500).send('Failed to handle timesheet submission')
  }
}

// Start the server
app.listen(port, () => {
  console.log(`Slack app listening at http://localhost:${port}`)
})

//lambda handling
const serverless = require('serverless-http')
const handler = serverless(app)

exports.handler = async (event, context, callback) => {
  const response = handler(event, context, callback)
  return response
}
