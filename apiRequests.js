const fs = require('fs');
const path = require("path");
const axios = require('axios')
const { searchActivityQuery, getMomentsFromPacks, searchMintedMoments } = require('./queries')
const tsUrl = "https://api.nba.dapperlabs.com/marketplace/graphql"
const { DateTime } = require("luxon");
const { today, projectFolder, activityFilesPath } = require('./common');
const Bottleneck = require("bottleneck/es5")


const limiter = new Bottleneck({
  minTime: 25, //how long to wait between requests (ie 40 requests a second)
  maxConcurrent: 1,
})


async function validExchangeApiKey(apiKey) {
  const url = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}`
  try {
    const response = await axios.get(url);
    if (response.data.error) {
      throw new Error(response.data.description)
    } else {
      return true
    }
  } catch (error) {
    // console.error(error);
    return false
  }
}

async function getExchangeRate(briefDate, appId, selectedCurrency) {
  const baseUrl = `https://openexchangerates.org/api/historical/${briefDate}.json?app_id=${appId}`
  try {
    const response = await axios.get(baseUrl);
    return response.data.rates[selectedCurrency]
  } catch (error) {
    console.log(error);
  }
}

// {
//   dapperID
//   flowAddress
//   createdAt
//   __typename
// }

async function validTopShotToken(token) {
  if (!token && process.env.DEV_MODE) {
    token = process.env.X_ID_TOKEN
  }
  const queryBody =
    { "operationName": "GetMyProfile", "variables": {}, "query": "query GetMyProfile {\n  getMyProfile {\n    email\n    tradeTicketCount\n    momentCount\n    marketingCampaign\n    publicInfo {\n      dapperID\n      flowAddress\n      username\n      profileImageUrl\n      createdAt\n      favoriteTeamID\n      ownedSpecialNFTTypes\n      __typename\n    }\n    __typename\n  }\n}\n" }

  // Make a request
  try {
    const response = await axios({
      method: 'post',
      url: `${tsUrl}?GetMyProfile`,
      data: queryBody,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-id-token': token
      }
    })

    if (response.data.errors) {
      throw new Error(response.data.errors[0] ? response.data.errors[0].message : 'unknown error')
    } else {
      return {
        dapperID: response.data.data.getMyProfile.publicInfo.dapperID,
        flowAddress: response.data.data.getMyProfile.publicInfo.flowAddress,
      }
    }

  } catch (e) {
    console.log('ERRORING', e)
    return false
  }
}

async function getTopShotSearchActivity(token) {
  if (!token && process.env.DEV_MODE) {
    token = process.env.X_ID_TOKEN
  }
  const variables = {
    "byUnread": null,
    "byStatus": [],
    "byType": [
      "PURCHASE_VENDOR_MOMENT",
      "PURCHASE_PACK",
      "PURCHASE_PACK_WITH_TICKETS",
      "MOMENT_TRANSFER_RECEIVED",
      "MOMENT_TRANSFER_REQUEST",
      "PURCHASE_P2P_MOMENT",
      "P2P_MOMENT_LISTING_SOLD",
      "MOMENT_TRADE_IN_REQUEST",
      "MOMENTS_TRADE_IN_REQUEST",
      "OFFER_AVAILABLE",
      "OFFER_COMPLETED"
    ],
    "searchInput": {
      "pagination": {
        "cursor": "",
        "direction": "RIGHT",
        "limit": 1000 // to do handle those who have more than 1000
      }
    },
    "sortBy": "CREATED_AT_DESC"
  }
  const queryBody = JSON.stringify({ query: searchActivityQuery, variables })

  // Make a request
  try {
    const response = await axios({
      method: 'post',
      url: tsUrl,
      data: queryBody,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-id-token': token
      }
    })

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message)
    }
    // Save response to file (this is to prevent multiple requests run on same day)
    const results = response.data.data.SearchActivity.searchSummary.data
    const data = JSON.stringify(results);
    fs.writeFileSync(path.join(activityFilesPath, `${today}_activity.json`), data);
    return response.data.data.SearchActivity.searchSummary.data
  } catch (e) {
    console.log(e)
    return false
  }
}

async function getTopShotPackInfo(token, packDetails) {
  if (!token && process.env.DEV_MODE) {
    token = process.env.X_ID_TOKEN
  }

  const variables = {
    "input": {
      "packIDs": Object.keys(packDetails)
    }
  }
  const queryBody = JSON.stringify({ query: getMomentsFromPacks, variables })

  // Make a request
  try {
    const response = await axios({
      method: 'post',
      url: tsUrl,
      data: queryBody,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-id-token': token
      }
    })

    if (response.data.errors) {
      console.log(response.data.errors)
      throw new Error(response.data.errors[0].message)
    }

    // add moment details to packs
    const packsWithNoMomentInfo = {}
    const momentIdWithPackDetails = {}
    response.data.data.getPacks.packs.data
      .forEach(packInfo => {
        for (const momentId of packInfo.momentIds) {
          momentIdWithPackDetails[momentId] = {
            ...packDetails[packInfo.id],
            fromPackId: packInfo.id,
            costOfMoment: packInfo.momentIds.length && (packDetails[packInfo.id].costOfPack > 0 ? packDetails[packInfo.id].costOfPack / packInfo.momentIds.length : 0)
          }
        }
        if (packInfo.momentIds.length === 0) {
          packsWithNoMomentInfo[packInfo.id] = {
            ...packDetails[packInfo.id],
            moments: packInfo.momentIds,
          }
        }
      })
    return { packsWithNoMomentInfo: packsWithNoMomentInfo, momentIdWithPackDetails: momentIdWithPackDetails }
  } catch (e) {
    console.log(e)
    return false
  }
}


async function findMomentDetailsOfSerial(flowId) {
  const addQuery = searchMintedMoments

  const body = { "operationName": "SearchMintedMoments", "variables": { "sortBy": "SERIAL_NUMBER_ASC", "byOwnerDapperID": [], "byOwnerFlowAddress": [], "bySets": [], "bySeries": [], "bySetVisuals": [], "byLeagues": [], "byMomentTiers": [], "byPlayers": [], "byPlays": [], "byTeams": [], "byPlayCategory": [], "byPlayTagIDs": [], "bySetPlayTagIDs": [], "byPrimaryPlayerPosition": [], "byActiveChallenge": [], "byEditions": [], "byGroupSlug": null, "byPotentialTopshotScore": true, "byLockStatus": null, "byFlowID": [flowId], "searchInput": { "pagination": { "cursor": "", "direction": "RIGHT", "limit": 1000 } } }, "query": addQuery }

  const queryBody = JSON.stringify(body)

  // Make a request
  try {
    const response = await axios({
      method: 'post',
      url: tsUrl,
      data: queryBody,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    })

    if (response.data.errors) {
      console.log(response.data.errors)
      throw new Error(response.data.errors[0].message)
    }

    const results = response.data.data.searchMintedMoments.data.searchSummary.data.data

    return results[0]

  } catch (e) {
    console.log(e)
    throw e
  }
}

async function fetchResults(flowAddress, pageNumber) {
  console.log('Grabbing moment ranks page pageNumber', pageNumber)
  const mrUrl = `https://api.momentranks.com/v1/topshot/transactions?buyer=${flowAddress}&page=${pageNumber}&seller=0x${flowAddress}&sortBy=-blockTimestamp`

  // Make a request
  try {
    const response = await axios.get(mrUrl);
    return response.data

  } catch (e) {
    console.log('ERRORING', e)
    throw e
  }
}


async function getMomentRanksData(flowAddress) {
  let mrResults = []

  let hasNextPage = true
  let pageNumber = 1

  while (hasNextPage) {
    const response = await fetchResults(flowAddress, pageNumber)
    // add results to array
    mrResults = mrResults.concat(response.docs)
    hasNextPage = response.hasNextPage
    pageNumber = response.nextPage
  }

  const data = JSON.stringify({ data: mrResults });
  fs.writeFileSync(path.join(activityFilesPath, `${today}_activity_mr.json`), data);

  return mrResults;
}


module.exports = {
  validExchangeApiKey,
  validTopShotToken,
  getExchangeRate,
  getTopShotSearchActivity,
  getTopShotPackInfo,
  getMomentRanksData,
  findMomentDetailsOfSerial
}