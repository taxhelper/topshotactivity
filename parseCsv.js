const DataFrame = require("dataframe-js").DataFrame
const Bottleneck = require("bottleneck/es5")
const { DateTime } = require('luxon');
const _ = require('lodash');
const path = require("path");
const fs = require("fs");
const { getExchangeRate, getTopShotPackInfo, getTopShotSearchActivity, getMomentRanksData, findMomentDetailsOfSerial } = require('./apiRequests')
const { today, getDaysHeld, timestamp, projectFolder, filesPath, activityFilesPath } = require('./common')

let purchasedPacks = {};

// These are included in dapper csv
const headersIncluded = [
  "activity",
  "date",
  "subtotal_usd",
  "fee_usd",
  "total_usd",
  "payment_method",
  "payment_id",
  "status",
]

const additionalHeaders = [
  "id",
  "dapper_sale_fee_usd",
  "dapper_sale_fee_to_currency",
  "other_currency",
  "usd_to_currency_rate",
  "total_currency",
  "json_data_id",
  "item",
  "player",
  "play_category",
  "team",
  "flow_token_id",
  "other_party_to_transactionId",
  "other_party_to_transaction",
  "main_data_source",
  "order_id",
  "moment_play_id",
  "set_or_pack_ids",
  "serial_number",
  "activity_details",
  "set_information",
  "is_pack",
  "pack_quantity",
  "moment_general_path",
  "moment_serial_path",
  "moment_id",
  "sale_profit_usd",
  "sale_profit_currency",
  "from_pack_id",
  "days_held",
  "account_balance",
  "account_balance_currency",
  "forex_realisation",
  "forex_gain",
  "selected_timezone",
  "date_in_selected_timezone"
]

const limiter = new Bottleneck({
  minTime: 25, //how long to wait between requests (ie 40 requests a second)
  maxConcurrent: 1,
})

async function parseCsv({
  useDefaultTimezone,
  selectedTimezone,
  detectedTimezone,
  getExchangeRate,
  selectedCurrency,
  exchangeRateAppId,
  fileName,
  topshotToken,
  dapperID = process.env.DAPPER_ID,
  flowAddress = process.env.FLOW_ADDRESS
}) {

  console.log('flowAddress', flowAddress)
  console.log('dapperID', dapperID)

  const csvFile = process.env.DEV_MODE ? 'sample.csv' : `${fileName}`

  // this is to deal with issue in dataframe-js package where windows files aren't given correct file:// prefix
  const usePath = process.platform === 'win32' ? `file://${path.join(filesPath, csvFile)}` : path.join(filesPath, csvFile)
  let df = await DataFrame.fromCSV(usePath);

  console.log('Total rows', df.count())

  // first let's rename the columns
  df = df.renameAll(headersIncluded)

  // then let's sort the DF by createdAt
  df = df.sortBy('date')

  // Extract activity type (sale or purchase)
  df = df.withColumn('activity_type', (row) => {
    const activity = row.get('activity')
    // manually handle offer purchases
    if (activity === 'Dapper ACCEPTED') {
      return 'purchase'
    }
    return activity.split(" ").pop()
  })

  // Remove NFL All Day for now
  df = df.filter(row => !(/Gaia sale|NFL ALL DAY.+/).test(row.get('activity')))
  // remove cancelled
  df = df.filter(row => row.get('status') !== 'CANCELLED')

  // map over rows:
  // convert dates to ISO strings
  df = df.map(row => row.set(['date'], new Date(row.get('date')).toISOString()))
  // add briefDate column
  df = df.withColumn('brief_date', (row) => row.get('date').split("T")[0])

  const useZone = useDefaultTimezone ? detectedTimezone : selectedTimezone
  // add selectedTimezone details if exists
  console.log(useZone)

  // set dollar values as numbers
  df = df.withColumn('subtotal_usd', (row) => Number(row.get('subtotal_usd')))
  df = df.withColumn('fee_usd', (row) => Number(row.get('fee_usd')))
  df = df.withColumn('total_usd', (row) => Number(row.get('total_usd')))

  // add additional headers
  for (const [i, el] of additionalHeaders.entries()) {
    if (el === "id") {
      df = df.withColumn(el, (row, index) => index + 1) // start id at 1
    } else {
      df = df.withColumn(el)
    }
  }

  // add timezone and converted dates info
  df = df.map(row => {
    row = row.set('selected_timezone', useZone)
    row = row.set('date_in_selected_timezone', DateTime.fromISO(row.get('date')).setZone(useZone).toISO())
    return row
  })

  if (getExchangeRate && selectedCurrency && exchangeRateAppId || (process.env.DEV_MODE && process.env.SKIP_EXCHANGE !== "true")) {
    console.log('Getting exchange rate for currency...')
    const appId = exchangeRateAppId || process.env.OPEN_APP_ID
    const currency = selectedCurrency || 'AUD'
    df = await getRatesForDates(df, appId, currency)
  }

  // do this after top shot activity
  console.log('Getting Moment Ranks activity to help with reconcilation')
  let mrActivity;
  try {
    mrActivity = require(path.join(activityFilesPath, `${today}_activity_mr.json`))
  } catch (e) {
    // silent error - file likely does not exist so fetch from topshot
    mrActivity = await getMomentRanksData(flowAddress)
  }

  // Now get the Top Shot activity
  console.log('Getting topshot activity...')
  let topShotActivity;
  try {
    topShotActivity = require(path.join(activityFilesPath, `${today}_activity.json`))
  } catch (e) {
    // silent error - file likely does not exist so fetch from topshot
    topShotActivity = await getTopShotSearchActivity(topshotToken)
  }
  const { size: topShotActivityCount, data: topShotActivityData } = topShotActivity;

  console.log('Reconciling activity with export...')
  df = await reconcileActivityWithExport(df, topShotActivityData, mrActivity, dapperID)
  df = await addTradesAndGifts(df, topShotActivityData, selectedCurrency)
  // sort again
  df = df.sortBy('date')

  // work out cumulative account balance
  console.log('Adding account balance...')
  df = addAccountBalance(df)

  // Match moments to packs
  console.log('Matching moments to packs...', purchasedPacks)
  if (Object.keys(purchasedPacks).length) {
    const { packsWithNoMomentInfo, momentIdWithPackDetails } = await getTopShotPackInfo(topshotToken, purchasedPacks)
    // now update dataframe for these moments
    console.log('\n')
    console.log('You will need to manually check: packsWithNoMomentInfo :', packsWithNoMomentInfo)
    console.log('momentIdWithPackDetails', momentIdWithPackDetails)
    df = await reconcileMomentsWithPacks(df, momentIdWithPackDetails)
  }

  console.log('Working out profits from P2P purchases and sales...')
  // get all sales not from pack, and work out profit from sale
  const allPurchases = df.filter(row => ["PURCHASE_P2P_MOMENT", "OFFER_AVAILABLE"].includes(row.get('activity_details')))
  const allPurchasesObject = allPurchases.toCollection(true)
  const allPurchasesObjectValues = allPurchasesObject.map(purchase => purchase.toDict())

  df = await reconcileSalesWithP2PPurchases(df, allPurchasesObjectValues)

  // calculate forex gains and losses
  if (getExchangeRate && selectedCurrency) {
    console.log('Calculating forex gains and losses...')
    df = await calculationForexRealistion(df)
  }

  // save the dataframe to CSV
  const newOutputFile = `${today}_${timestamp}_output.csv`
  df.toCSV(true, path.join(projectFolder, newOutputFile))

  console.log('Calculations done.')
  console.log('\n')
  console.log('Output CSV saved to: ', newOutputFile)
}

// calculationForexRealistion
// FIRST IN FIRST OUT METHOD
// See https://www.ato.gov.au/business/foreign-exchange-gains-and-losses/in-detail/use-of-first-in-first-out-method-for-fungible-assets,-rights-and-obligations/
// A withdrawal from a foreign currency denominated bank account that has a credit balance will result in the occurrence of forex realisation event (FRE)
// Treating Dapper balance as akin to bank account - and using currency AUD as example
// EXAMPLE $100 USD withdrawal
// The forex realisation loss brought to account under FRE is
// Australian dollar equivalent (ADE) of withdrawal of $US1,000
// $A1,369.86
// Less: FIFO ADE cost of $US1,000
// $A1,388.89
// Forex loss
// $A 19.03
async function calculationForexRealistion(df) {
  const depositActivities = ['NBA Top Shot sale', 'Dapper purchase', 'Dapper receive', 'Dapper adjustment'];
  const withdrawalActivities = ['Dapper withdrawal', 'NBA Top Shot purchase', 'Dapper ACCEPTED'];

  // Get all deposit activities
  let allDeposits = df.filter(row => depositActivities.includes(row.get('activity')) && row.get('total_usd') > 0)
  allDeposits = allDeposits.sortBy('date')
  const allDepositsObject = allDeposits.toCollection(true)
  const deposits = {}
  allDepositsObject.forEach((depositActivity, index) => {
    const despositObject = depositActivity.toDict()
    deposits[index] = {
      currencyAmount: despositObject.total_currency,
      usdAmount: despositObject.total_usd,
      date: despositObject.date,
      exchange: despositObject.usd_to_currency_rate,
      remaining: despositObject.total_usd,
      id: despositObject.id,
      depositPaymentId: despositObject.payment_id
    }
  })

  // Now go through the df and deal with each withdrawal activity
  df = df.map(
    row => {
      if (withdrawalActivities.includes(row.get('activity'))) {
        // For Top Shot a "deposit" has to happen before the first withdrawal. Mostly likely a purchase was the first activity - and this is generally treated as a "withdrawal" from the Dapper Balance.
        // Let's just skip any withdrawal while the account balance is zero and happens before the first "deposit" activity
        const firstDepositDate = deposits[0].date
        if (row.get('date') < firstDepositDate) {
          return row
        }

        let depositKey
        for (const [key, val] of Object.entries(deposits)) {
          if (val.remaining > 0) {
            depositKey = key;
            break;
          }
        }

        const currencyWithdrawal = row.get('total_currency');
        const depositsUsed = [deposits[depositKey].depositPaymentId]
        const depositDates = [deposits[depositKey].date]
        let warning;
        const calculateCurrencyEquivalentCost = (depositKey, usdWithdrawal, partialCalculated = 0) => {
          if (warning) {
            return;
          }

          if (deposits[depositKey].remaining >= usdWithdrawal) {
            deposits[depositKey].remaining = deposits[depositKey].remaining - usdWithdrawal;

            return partialCalculated + (deposits[depositKey].exchange * usdWithdrawal);
          } else {
            // calculate what we have
            const partialCurrencyEquivalentCost = partialCalculated + (deposits[depositKey].exchange * deposits[depositKey].remaining);
            const toCarry = usdWithdrawal - deposits[depositKey].remaining;

            // reset the remaining to 0
            deposits[depositKey].remaining = 0;
            const newDepositKey = (parseInt(depositKey) + 1);
            if (deposits[newDepositKey]) {
              depositsUsed.push(deposits[newDepositKey].depositPaymentId);
              depositDates.push(deposits[depositKey].date);
              return calculateCurrencyEquivalentCost(newDepositKey, toCarry, partialCurrencyEquivalentCost);
            } else {
              warning = 'Recalculate - No next deposit';
              console.log(warning)
              return;
            }
          }
        }

        const currencyEquivalentCost = calculateCurrencyEquivalentCost(depositKey, row.get('total_usd'));

        if (currencyEquivalentCost === 0) {
          return row;
        }
        const forexGain = currencyWithdrawal - currencyEquivalentCost;

        const forexRealisation = {
          currencyWithdrawal: currencyWithdrawal,
          currencyEquivalentCost: currencyEquivalentCost,
          forexGain: forexGain,
          depositsUsed: depositsUsed,
          depositDates: depositDates,
          withdrawalDate: row.get('date')
        }

        // console.log('ID', row.get('id'))
        // console.log('FR', forexRealisation)

        row = row.set("forex_realisation", JSON.stringify(forexRealisation))
        row = row.set("forex_gain", forexGain)

      }
      return row
    })

  return df
}

async function reconcileSalesWithP2PPurchases(df, purchases) {
  console.log('If any unknown purchase origins are recorded below they may be challenge rewards or a moment from a pack that was not properly recorded')
  df = df.map(
    row => {
      // if a sale..
      if (['P2P_MOMENT_LISTING_SOLD', 'OFFER_COMPLETED'].includes(row.get('activity_details'))) {
        // find the purchase details
        const purchaseDetails = purchases.find(purchase => purchase.moment_id === row.get('moment_id'))
        if (purchaseDetails) {
          // update row data
          const saleProfit = purchaseDetails.subtotal_usd - row.get('total_usd')
          row = row.set('sale_profit_usd', saleProfit)
          if (row.get('usd_to_currency_rate')) {
            row = row.set('sale_profit_currency', (saleProfit * row.get('usd_to_currency_rate')).toFixed(2))
          }
          const daysHeld = getDaysHeld(purchaseDetails.date, row.get('date'))
          row = row.set('days_held', daysHeld)
        } else {
          if (!row.get('sale_profit_usd')) {
            // this might be a challenge moment or a moment from a pack that wasn't properly recorded
            console.log('Unknown purchase origin for sale payment_id: ', row.get('payment_id'))
          }
        }
      }
      return row
    })
  return df
}

function getOrderSpecifier(activityType) {
  let orderSpecifier = "order"
  if (activityType === 'MOMENT_TRADE_IN_REQUEST') {
    orderSpecifier = "tradeIn"
  } else if (activityType === 'MOMENT_TRANSFER_REQUEST') {
    orderSpecifier = "transfer"
  } else if (['OFFER_AVAILABLE', 'OFFER_COMPLETED'].includes(activityType)) {
    orderSpecifier = "offer"
  }
  return orderSpecifier
}

async function reconcileMomentsWithPacks(df, momentIdWithPackDetails) {
  df = df.map(
    row => {
      const momentDetails = momentIdWithPackDetails[row.get('moment_id')]
      if (momentDetails && row.get('activity') === 'NBA Top Shot sale') {
        // update the row details
        // use subtotal usd to take into account VISA purchases
        const saleProfit = row.get('subtotal_usd') - momentDetails.costOfMoment
        row = row.set('sale_profit_usd', saleProfit)
        if (row.get('usd_to_currency_rate')) {
          row = row.set('sale_profit_currency', (saleProfit * row.get('usd_to_currency_rate')).toFixed(2))
        }
        row = row.set('from_pack_id', momentDetails.fromPackId)
        const daysHeld = getDaysHeld(momentDetails.purchased, row.get('date'))
        row = row.set('days_held', daysHeld)
      }
      return row
    }
  )

  return df

}
function addAccountBalance(df) {
  // iterate over each row (rather than each activity)

  let accountBalance = 0
  df = df.map(
    row => {
      if (row.get('status') !== 'SUCCEEDED' || row.get('payment_method') === 'VISA') {
        // no change
        accountBalance = accountBalance
      } else if ((/.+sale|Dapper purchase|Dapper receive|Dapper adjustment/).test(row.get('activity'))) {
        accountBalance = accountBalance + Number(row.get('total_usd'));
      } else if ((/.+purchase|Dapper withdrawal|Dapper ACCEPTED/).test(row.get('activity'))) {
        accountBalance = accountBalance - Number(row.get('total_usd'));
      }

      row = row.set('account_balance', accountBalance.toFixed(2))
      if (row.get('usd_to_currency_rate')) {
        row = row.set('account_balance_currency', (accountBalance * row.get('usd_to_currency_rate')).toFixed(2))
      }

      return row
    })
  return df
}

function getMatchingActivity(topShotActivityData, row, usedActivityIdMatches, dateSubstringLimit = 16) {

  const date = row.get('date')
  const subTotal = row.get('subtotal_usd')
  const totalUsd = row.get('total_usd')
  const paymentMethod = row.get('payment_method')
  const saleOrPurchase = row.get('activity_type')
  // note using subtotal here
  let priceToCompare;
  // if offer
  if (['Dapper offer sale', 'Dapper ACCEPTED'].includes(row.get('activity'))) {
    // Dapper activity csv suggests all offers have fees
    priceToCompare = (subTotal / 0.95).toFixed(2)
  } else if (paymentMethod === 'Dapper Balance') {
    priceToCompare = saleOrPurchase === 'sale' ? (subTotal / 0.95).toFixed(2) : subTotal.toFixed(2);
  } else {
    priceToCompare = subTotal.toFixed(2)
  }
  const matchedArray = _.filter(topShotActivityData, (activity) => {
    // skip these ones for now
    // MOMENT_TRANSFER_REQUEST, MOMENT_TRANSFER_RECEIVED = gifts (not in csv download file)
    // MOMENT_TRADE_IN_REQUEST = trade for tickets
    if (['MOMENT_TRANSFER_REQUEST', 'MOMENT_TRANSFER_RECEIVED', 'MOMENT_TRADE_IN_REQUEST'].includes(activity.activityType) ||
      activity.status !== "SUCCESS") {
      return false
    }

    const orderSpecifier = getOrderSpecifier(activity.activityType)
    let dateToCompare = 'createdAt'

    // if this is an offer suggested (for purchasing)
    if (activity.activityType === 'OFFER_AVAILABLE') {
      // don't consider trying to match if not a completed purchase (ie if pending)
      if (!activity.subject.offer.completed || !activity.subject.offer.purchased) {
        return false
      }
    }

    if (['OFFER_AVAILABLE', 'OFFER_COMPLETED'].includes(activity.activityType)) {
      // use updatedAt date for OFFERS_AVAILABLE as that represents when the purchase was made
      dateToCompare = 'updatedAt'
    }

    const dateIsEqual = date.substring(0, dateSubstringLimit) === activity[dateToCompare].substring(0, dateSubstringLimit)
    const activityPrice = activity.subject[orderSpecifier].price;
    const priceIsEqual = priceToCompare == Number(activityPrice).toFixed(2)

    const activityNotAlreadyMatched = !usedActivityIdMatches.includes(activity.id)

    return dateIsEqual && priceIsEqual && activityNotAlreadyMatched
  })

  if (!matchedArray.length) {
    // try again until date is too short
    if (dateSubstringLimit > 13) {
      return getMatchingActivity(topShotActivityData, row, usedActivityIdMatches, dateSubstringLimit - 1)
    }
  }

  return matchedArray
}

function tryAndPopulateFromMrActivity(mrActivity, date, totalUsd, saleOrPurchase, dapperID, matchedMrActivities, dateSubstringLimit = 16) {
  const role = saleOrPurchase === 'sale' ?
    'seller' : 'buyer';
  const totalUsdWithFees = saleOrPurchase === 'sale' ?
    (totalUsd / 0.95).toFixed(2) : totalUsd;
  const matchedArray = _.filter(mrActivity.data, (activity) => {
    try {
      const activityTypeMatches = activity[role] && activity[role].dapperId === dapperID;

      const dateIsEqual = date.substring(0, dateSubstringLimit) === activity.blockTimestamp.substring(0, dateSubstringLimit)
      const priceIsEqual = totalUsdWithFees == Number(activity.price).toFixed(2)

      const activityNotAlreadyMatched = !matchedMrActivities.includes(activity.blockTimestamp)

      return dateIsEqual && priceIsEqual && activityNotAlreadyMatched && activityTypeMatches
    } catch (e) {
      console.log(activity)
      throw e
    }
  })

  if (!matchedArray.length) {
    // try again until date is too short
    if (dateSubstringLimit > 13) {
      return tryAndPopulateFromMrActivity(mrActivity, date, totalUsd, saleOrPurchase, dapperID, matchedMrActivities, dateSubstringLimit - 1)
    }
  }

  return matchedArray

}

function prepareDataForRow(activity, isPack, orderSpecifier) {
  const item = isPack ? activity.subject.order.packListing.title : `${activity.subject[orderSpecifier].moment.play.stats.playerName}-${activity.subject[orderSpecifier].moment.play.stats.playCategory}`;
  const player = !isPack && activity.subject[orderSpecifier].moment.play.stats.playerName
  const playCategory = !isPack && activity.subject[orderSpecifier].moment.play.stats.playCategory
  const serialNumber = isPack ? null : activity.subject[orderSpecifier].moment.flowSerialNumber;
  const orderId = activity.subject[orderSpecifier].id;
  const setInformation = isPack ? null : activity.subject[orderSpecifier].moment.set.setVisualId;
  const momentId = isPack ? null : activity.subject[orderSpecifier].moment.id;
  const momentPlayId = isPack ? null : activity.subject[orderSpecifier].moment.play.id;
  const setOrPackIds = isPack ? activity.subject.order.packs.map(p => p.id) : activity.subject[orderSpecifier].moment.set.id;
  const momentGeneralPath = isPack ? null : `https://nbatopshot.com/listings/p2p/${setOrPackIds}+${momentPlayId}`;
  const momentSerialPath = isPack ? null : `https://nbatopshot.com/moment/${momentId}`;
  let price;
  if (activity.activityType === 'P2P_MOMENT_LISTING_SOLD') {
    price = activity.subject.order.price * 0.95;
  } else if (['PURCHASE_PACK_WITH_TICKETS', 'MOMENT_TRADE_IN_REQUEST'].includes(activity.activityType)) {
    price = 0
  } else if (['OFFER_COMPLETED', 'OFFER_AVAILABLE'].includes(activity.activityType)) {
    price = activity.subject.offer.price
  } else {
    price = activity.subject.order.price
  }

  return {
    item,
    player,
    playCategory,
    serialNumber,
    orderId,
    setInformation,
    momentId,
    momentPlayId,
    setOrPackIds,
    momentGeneralPath,
    momentSerialPath,
  }
}

function prepareDataForRowMr(activity, saleOrPurchase) {
  const item = `${activity.moment.playerName}-${activity.moment.playCategory}`;
  const player = activity.moment.playerName
  const playCategory = activity.moment.playCategory
  const serialNumber = activity.serialNumber
  const orderId = null
  const setInformation = activity.moment.setVisualId;
  const momentId = null
  const momentPlayId = activity.moment.playDapperId;
  const setOrPackIds = activity.moment.setDapperId;
  const momentGeneralPath = `https://nbatopshot.com/listings/p2p/${setOrPackIds}+${momentPlayId}`;
  const momentSerialPath = null
  let price;
  if (saleOrPurchase === 'sale') {
    price = activity.price * 0.95;
  } else {
    price = activity.price
  }
  return {
    item,
    player,
    playCategory,
    serialNumber,
    orderId,
    setInformation,
    momentId,
    momentPlayId,
    setOrPackIds,
    momentGeneralPath,
    momentSerialPath,
  }
}

async function reconcileActivityWithExport(df, topShotActivityData, mrActivity, dapperID) {
  console.log('Top Shot Activity Length: ', topShotActivityData.length)

  let noMatch = []
  let usedActivityIdMatches = []
  let matchedMrActivities = []
  const momentsToLookup = []

  // iterate over each row (rather than each activity)
  df = df.map(
    row => {
      if (row.get("json_data_id") === undefined &&
        row.get("status") === 'SUCCEEDED') {

        // ignore some events
        const activitiesToIgnore = ['Dapper adjustment', 'Dapper withdrawal', 'Dapper purchase', 'Dapper receive', 'NBA Top Shot receive']
        if (activitiesToIgnore.includes(row.get('activity'))) {
          return row
        }

        // preconditions met
        const activityArray = getMatchingActivity(topShotActivityData, row, usedActivityIdMatches)

        let activity;
        if (!activityArray.length) {
          // try and find it from moment ranks activities if not an offer
          const mrActivitiesArray = tryAndPopulateFromMrActivity(mrActivity, row.get('date'), row.get('subtotal_usd'), row.get('activity_type'), dapperID, matchedMrActivities)

          if (mrActivitiesArray.length) {
            activity = mrActivitiesArray[0]
            activity.source = 'momentRanks'
            matchedMrActivities.push(activity.blockTimestamp)
          } else {
            console.log(`>>>>>>>>>> NO MATCH FOR payment Id ${row.get('payment_id')} --- ${row.get('activity')} <<<<<<<<<`);
            noMatch.push(row.toDict())
          }
        } else if (activityArray.length > 1) {
          // console.log(`>>>>>>>>>> MULTIPLE MATCHES FOR payment Id ${row.get('payment_id')} <<<<<<<<<`);
          // console.log(`>>>>>>>>>> MATCHES are ${activityArray.map(a => a.id)} <<<<<<<<<`);
          // pick first match
          activity = activityArray[0]
          activity.source = 'topShot'
          // save to usedMatch as likely another will be found so don't pick this one again
          usedActivityIdMatches.push(activityArray[0].id)
        } else {
          activity = activityArray[0]
          activity.source = 'topShot'
        }
        if (activity) {
          console.log('Working on ', row.get('payment_id'))
          let rowData
          let dapperSaleFee
          let jsonDataId
          let activityDetails
          let mrActivityDetails
          let team
          let mrTokenId
          let otherPartyId
          let otherParty
          let isPack = false
          let packQuantity

          if (activity.source === 'momentRanks') {
            momentsToLookup.push(activity.tokenId)

            rowData = prepareDataForRowMr(activity, row.get('activity_type'))

            team = activity.moment?.team
            mrTokenId = activity.tokenId
            const otherPartyType = row.get('activity_type') === 'sale' ?
              'buyer' : 'seller'

            otherPartyId = activity[otherPartyType]?.dapperId
            otherParty = activity[otherPartyType]?.username

            dapperSaleFee = row.get('activity_type') === 'sale' ?
              (row.get('total_usd') / 0.95) - row.get('total_usd') : 0;

          } else {
            jsonDataId = activity.id;

            activityDetails = activity.activityType;

            packQuantity = 0;
            isPack = ['PURCHASE_PACK', 'PURCHASE_PACK_WITH_TICKETS'].includes(activity.activityType);
            if (isPack) {
              packQuantity = activity.subject.order.packs.quantity || activity.subject.order.packs.length;
              for (const pack of activity.subject.order.packs) {
                purchasedPacks[pack.id] = {
                  purchased: activity.createdAt,
                  costOfPack: activity.activityType === 'PURCHASE_PACK_WITH_TICKETS' ? 0 : activity.subject.order.packListing.priceV2.value
                }
              }
            }

            const orderSpecifier = getOrderSpecifier(activity.activityType)

            rowData = prepareDataForRow(activity, isPack, orderSpecifier)

            if (!isPack) {
              const mrMatched = _.filter(mrActivity.data, (mr) => {
                if (matchedMrActivities.includes(mr.blockTimestamp)) return false
                try {
                  const matchedSerial = Number(rowData.serialNumber) == mr.serialNumber
                  const matchedDate = activity.createdAt.split("T")[0] == mr.blockTimestamp.split("T")[0]
                  const matchedSaleType = row.get('activity_type') === 'sale' ?
                    mr.seller && mr.seller.dapperId === dapperID :
                    mr.buyer && mr.buyer.dapperId === dapperID;

                  let matched = matchedSerial && matchedDate && matchedSaleType
                  if (mr.moment) {
                    const matchedMomentPlayId = rowData.momentPlayId === mr.moment.playDapperId
                    matched = matched && matchedMomentPlayId
                  }
                  return matched
                } catch (e) {
                  console.log(mr)
                  throw e
                }
              })
              if (mrMatched.length) {
                mrActivityDetails = mrMatched[0]
                // use timestamp - maybe tokenId is better but unsure what this means
                matchedMrActivities.push(mrActivityDetails.blockTimestamp)
              }
            }

            team = mrActivityDetails && mrActivityDetails.moment?.team
            mrTokenId = mrActivityDetails && mrActivityDetails.tokenId
            const otherPartyType = row.get('activity_type') === 'sale' ?
              'buyer' : 'seller'
            otherPartyId = mrActivityDetails && mrActivityDetails[otherPartyType] && mrActivityDetails[otherPartyType].dapperId
            otherParty = mrActivityDetails && mrActivityDetails[otherPartyType] && mrActivityDetails[otherPartyType].username

            if (['P2P_MOMENT_LISTING_SOLD', 'OFFER_AVAILABLE', 'OFFER_COMPLETED'].includes(activity.activityType)) {
              dapperSaleFee = (row.get('total_usd') / 0.95) - row.get('total_usd')
            } else {
              dapperSaleFee = 0;
            }
          }

          row = row.set('json_data_id', jsonDataId)
          row = row.set('item', rowData.item)
          row = row.set('player', rowData.player)
          row = row.set('play_category', rowData.playCategory)
          row = row.set('team', team)
          row = row.set('flow_token_id', mrTokenId)
          row = row.set('other_party_to_transactionId', otherPartyId)
          row = row.set('other_party_to_transaction', otherParty)
          row = row.set('main_data_source', activity.source)
          row = row.set('order_id', rowData.orderId)
          row = row.set('moment_play_id', rowData.momentPlayId)
          row = row.set('set_or_pack_ids', rowData.setOrPackIds)
          row = row.set('serial_number', rowData.serialNumber)
          row = row.set('activity_details', activityDetails)
          row = row.set('set_information', rowData.setInformation)
          row = row.set('moment_id', rowData.momentId)
          row = row.set('is_pack', isPack)
          row = row.set('pack_quantity', packQuantity)
          row = row.set('moment_general_path', rowData.momentGeneralPath)
          row = row.set('moment_serial_path', rowData.momentSerialPath)
          row = row.set('dapper_sale_fee_usd', Number(dapperSaleFee.toFixed(2)))
          if (row.get('usd_to_currency_rate')) {
            row = row.set('dapper_sale_fee_to_currency', row.get("usd_to_currency_rate") * dapperSaleFee)
          }
        }
      }
      return row
    }
  )

  const momentSearchResults = {}

  // if there's any moments we need to go look up, let's do that now
  for (const tokenId of momentsToLookup) {
    const serialDetails = await findMomentDetailsOfSerial(tokenId)
    if (serialDetails) {
      momentSearchResults[tokenId] = {
        momentId: serialDetails.id,
        momentGeneralPath: `https://nbatopshot.com/listings/p2p/${serialDetails.set.id}+${serialDetails.play.id}`,
        momentSerialPath: `https://nbatopshot.com/moment/${serialDetails.id}`
      }
    }
  }

  // add moment details
  df = df.map(
    row => {
      const flowTokenId = String(row.get('flow_token_id'))
      if (flowTokenId && Object.keys(momentSearchResults).includes(flowTokenId)) {
        row = row.set('moment_id', momentSearchResults[flowTokenId].momentId)
        row = row.set('moment_general_path', momentSearchResults[flowTokenId].momentGeneralPath)
        row = row.set('moment_serial_path', momentSearchResults[flowTokenId].momentSerialPath)
      }
      return row
    })
  return df
}


async function addTradesAndGifts(df, topShotActivityData, selectedCurrency, selectedTimezone) {
  const dfLength = df.count()

  // add in ticket and gifting activity which would not be part of export csv
  const allGiftsAndSwapsForTickets = topShotActivityData.filter(activity => ['MOMENT_TRADE_IN_REQUEST', 'MOMENT_TRANSFER_REQUEST', 'MOMENT_TRANSFER_RECEIVED'].includes(activity.activityType))

  const additionalRows = []

  for (const [index, activity] of allGiftsAndSwapsForTickets.entries()) {
    const orderSpecifier = activity.activityType === 'MOMENT_TRADE_IN_REQUEST' ? "tradeIn" : "transfer"
    const paymentMethod = activity.activityType === 'MOMENT_TRADE_IN_REQUEST' ? 'Trade In' : 'Gift'
    const briefDate = activity.createdAt.split("T")[0]
    const newRow = {
      activity: activity.activityType === 'MOMENT_TRANSFER_RECEIVED' ? 'NBA Top Shot purchase' : 'NBA Top Shot sale',
      date: activity.createdAt,
      subtotal_usd: 0,
      fee_usd: 0,
      total_usd: 0,
      payment_method: paymentMethod,
      payment_id: '',
      status: 'SUCCEEDED',
      activity_type: activity.activityType === 'MOMENT_TRANSFER_RECEIVED' ? 'purchase' : 'sale',
      brief_date: briefDate,
      id: dfLength + index + 1,
      dapper_sale_fee_usd: 0,
      dapper_sale_fee_to_currency: 0,
      other_currency: selectedCurrency,
      usd_to_currency_rate: 0,
      total_currency: 0,
      json_data_id: activity.id,
      item: `${activity.subject[orderSpecifier].moment.play.stats.playerName}-${activity.subject[orderSpecifier].moment.play.stats.playCategory}`,
      player: activity.subject[orderSpecifier].moment.play.stats.playerName,
      play_category: activity.subject[orderSpecifier].moment.play.stats.playCategory,
      team: '',
      flow_token_id: '',
      other_party_to_transactionId: '',
      other_party_to_transaction: '',
      main_data_source: 'topShot',
      order_id: activity.subject[orderSpecifier].id,
      moment_play_id: activity.subject[orderSpecifier].moment.play.id,
      set_or_pack_ids: activity.subject[orderSpecifier].moment.set.id,
      serial_number: activity.subject[orderSpecifier].moment.flowSerialNumber,
      activity_details: activity.activityType,
      set_information: activity.subject[orderSpecifier].moment.set.setVisualId,
      is_pack: false,
      pack_quantity: 0,
      moment_general_path: `listings/p2p/${activity.subject[orderSpecifier].moment.set.id}+${activity.subject[orderSpecifier].moment.play.id}`,
      moment_serial_path: `moment/${activity.subject[orderSpecifier].moment.id}`,
      moment_id: activity.subject[orderSpecifier].moment.id,
      sale_profit_usd: null,
      sale_profit_currency: null,
      from_pack_id: null,
      days_held: null,
      account_balance: null,
      account_balance_currency: null,
      selected_timezone: selectedTimezone,
      date_in_selected_timezone: activity.createdAt,
      forex_realisation: null,
      forex_gain: null,
    }

    additionalRows.push(newRow)
  }

  const newRowsDf = new DataFrame(additionalRows)
  console.log('Adding in trade ins and gifts')
  df = df.union(newRowsDf)


  return df
}

async function getRatesForDates(df, appId, currency) {
  let historicalRatesJson;
  try {
    historicalRatesJson = require(path.join(projectFolder, `/historicalRates${currency}.json`))
  } catch (e) {
    // silent error - file likely does not exist
    historicalRatesJson = {}
  }

  const briefDates = df.distinct('brief_date').toArray()

  const historicalRates = { ...historicalRatesJson }

  let dfCopy = df
  let index = 0
  for await (const date of briefDates) {
    const briefDate = date.toString()
    // console.log('Getting rate for ', briefDate)
    console.log(`${((index / briefDates.length) * 100).toFixed(1)}%...`)

    let rate
    if (historicalRates[briefDate]) {
      rate = historicalRates[briefDate]
    } else {
      rate = await limiter.schedule(() => getExchangeRate(briefDate, appId, currency))
      historicalRates[briefDate] = rate
    }

    const ratesDf = await dfCopy.chain(
      row => row.get("brief_date") === briefDate,
      row => row.set("usd_to_currency_rate", rate),
      row => row.set("total_currency", rate * row.get('total_usd')),
      row => row.set("other_currency", currency),
    )

    if (index == 0) {
      df = ratesDf
    } else {
      df = df.union(ratesDf)
    }
    index++
  }

  // write rates to reusable output file
  const data = JSON.stringify(historicalRates);
  fs.writeFileSync(path.join(projectFolder, `historicalRates${currency}.json`), data);
  return df
}

module.exports = parseCsv
