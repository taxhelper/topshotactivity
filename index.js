require('dotenv').config()
const { zones } = require('tzdata');
const { DateTime } = require('luxon');
const fs = require('fs');
const path = require("path");
const { projectFolder, filesPath } = require('./common')
const inquirer = require('inquirer');
inquirer.registerPrompt("date", require("inquirer-date-prompt"));

const currencyCodes = require('./currencies');
const { validExchangeApiKey, validTopShotToken } = require('./apiRequests')
const parseCsv = require('./parseCsv')

async function main() {
  let flowAddress;
  let dapperID;
  let savedAnswers;
  const luxonValidTimezones = [
    ...new Set(
      Object.keys(zones).filter(
        tz => tz.includes('/') && DateTime.local().setZone(tz).isValid
      )
    ),
  ].sort((a, b) => (a < b ? -1 : 1));

  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  console.log('Welcome to Top Shot Tax Helper');

  const fileNames = []
  fs.readdirSync(filesPath).forEach(file => {
    fileNames.push(file);
  });

  if (!fileNames.length) {
    throw new Error(`You must add your NBA Topshot CSV export to ${process.pkg ? 'the same folder as this program file' : `a directory named 'files' in the root directory.`}`)
  }

  const questions = [
    {
      type: 'confirm',
      name: 'useDefaultTimezone',
      message: `Is your time zone ${detectedTimezone}`,
      default: true,
    },
    {
      type: 'input',
      name: 'selectedTimezone',
      message: 'Type in your timezone (in the format America/Phoenix)',
      validate(value) {
        const pass = luxonValidTimezones.includes(value)
        if (pass) {
          return true;
        }

        return 'Please enter a valid timezone';
      },
      when(answers) {
        return !answers.useDefaultTimezone;
      },
    },
    {
      type: 'confirm',
      name: 'getExchangeRate',
      message: 'Do you need to know amounts in a currency other than USD?',
      default: false,
    },
    {
      type: 'input',
      name: 'selectedCurrency',
      message: 'Type in your currency (in the three letter format eg AUD)',
      validate(value) {
        const pass = currencyCodes.includes(value)
        if (pass) {
          return true;
        }
        return 'Please enter a valid currency';
      },
      filter(val) {
        return val.toUpperCase();
      },
      when(answers) {
        return answers.getExchangeRate;
      },
    },
    {
      type: 'password',
      name: 'exchangeRateAppId',
      mask: true,
      message: 'Paste your OpenExchangeRate AppId:',
      async validate(value) {
        if (process.env.DEV_MODE) return true
        const pass = await validExchangeApiKey(value)
        if (pass) {
          return true;
        }
        return 'This key does not appear to be valid.';
      },
      when(answers) {
        return answers.getExchangeRate;
      },
    },
    {
      type: 'list',
      name: 'fileName',
      message: 'Select your Dapper CSV downloaded file to use',
      choices: fileNames,
    },
    {
      type: 'password',
      name: 'topshotToken',
      mask: true,
      message: 'Paste your Top Shot idToken:',
      async validate(value) {
        if (process.env.DEV_MODE) return true
        const pass = await validTopShotToken(value)
        if (Boolean(pass)) {
          ({ dapperID, flowAddress } = pass)
          return true;
        }
        return 'This token does not appear to be valid. Please refresh the main website of NBA Top Shot and then, in the same browser window, visit https://nbatopshot.com/api/auth0/session to grab your idToken';
      },
    },
  ];

  if (fileNames.length) {
    if (process.env.DEV_MODE && process.env.SKIP_QUESTIONS === 'true') {
      await parseCsv({})

    } else {
      await inquirer.prompt(questions).then((answers) => {
        // console.log('\Inputted values:');
        // console.log(JSON.stringify(answers, null, '  '));
        console.log(`\n`)
        console.log('Preparing to process your csv...')
        savedAnswers = answers
        savedAnswers.dapperID = dapperID
        savedAnswers.flowAddress = flowAddress
        savedAnswers.detectedTimezone = detectedTimezone
      });
      try {
        await parseCsv(savedAnswers)

        console.log(`\n`)
        console.log('If this helped you, please consider sending a TopShot Gift to: jubilant_cornichons774o')
        console.log('https://nbatopshot.com/user/@jubilant_cornichons774o')
        console.log(`\n`)
        console.log(`\n`)
      } catch (e) {
        console.log(e)
      }
    }
  } else {
    console.log(`\n`)

    console.log('You need to add your Dapper CSV download to the files directory in this folder')
    console.log('This program cannot work until you have added your file.')
    console.log(`\n`)

    console.log('Exiting....')
  }
}


main()