const searchActivityQuery = `query SearchActivity($byUnread: Boolean, $byStatus: [ActivityStatus!], $byType: [ActivityType!], $sortBy: ActivitySortType, $searchInput: BaseSearchInput!) {
  SearchActivity(input: { filters: { byUnread: $byUnread, byStatus: $byStatus, byType: $byType }, sortBy: $sortBy, searchInput: $searchInput }) {
    filters {
      byUnread
      byStatus
      byType
      __typename
    }
    searchSummary {
      count {
        count
        __typename
      }
      pagination {
        leftCursor
        rightCursor
        __typename
      }
      data {
        ... on Activities {
          size
          data {
            ... on Activity {
              id
              activityType
              status
              isRead
              createdAt
              updatedAt
              sortID
              subject {
                ... on OfferAvailableActivity {
                  offer {
                    id
                    price
                    completed
                    purchased
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on OfferCompletedActivity {
                  offer {
                    id
                    price
                    completed
                    purchased
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on PurchasePackActivity {
                  order {
                    id
                    price
                    status
                    state
                    quantity
                    packListing {
                      id
                      title
                      preorder
                      priceV2 {
                        value
                        currency
                        __typename
                      }
                      __typename
                    }
                    packs {
                      id
                      momentIds
                      status
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on P2PMomentListingSoldActivity {
                  order {
                    id
                    price
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on PurchaseP2PMomentActivity {
                  order {
                    id
                    price
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on MomentTransferReceivedActivity {
                  transfer {
                    id
                    senderDapperID
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on MomentTransferRequestActivity {
                  transfer {
                    id
                    receiverDapperID
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on MomentTradeInRequestActivity {
                  tradeIn {
                    id
                    moment {
                      ...ActivityMomentDetails
                      __typename
                    }
                    __typename
                  }
                  __typename
                }
                ... on MomentsTradeInRequestActivity {
                  tradeIn {
                    id
                    momentIDs
                    __typename
                  }
                  __typename
                }
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment ActivityMomentDetails on MintedMoment {
  id
  tier
  play {
    id
    stats {
      playerName
      playCategory
      dateOfMoment
      __typename
    }
    __typename
  }
  set {
    id
    setVisualId
    __typename
  }
  setPlay {
    ID
    flowRetired
    circulationCount
    __typename
  }
  flowSerialNumber
  assetPathPrefix
  __typename
}`

const getMomentsFromPacks = `query DEFAULT_queryGetPacks($input: GetPacksInput!) {
  getPacks(input: $input) {
    packs {
      data {
        id
        status
        state
        momentIds
        __typename
      }
      __typename
    }
    __typename
  }
}
`

const searchMintedMoments = `query SearchMintedMoments($sortBy: MintedMomentSortType, $byOwnerDapperID: [String], $byOwnerFlowAddress: [String], $bySets: [ID], $bySeries: [ID], $bySetVisuals: [VisualIdType], $byLeagues: [League], $byMomentTiers: [MomentTier], $byPlayers: [ID], $byPlays: [ID], $byTeams: [ID], $byPlayCategory: [ID], $byPlayTagIDs: [ID], $bySetPlayTagIDs: [ID], $byPrimaryPlayerPosition: [PlayerPosition], $byActiveChallenge: [ID], $byEditions: [EditionsFilterInput], $byGroupSlug: String, $searchInput: BaseSearchInput!, $byPotentialTopshotScore: Boolean, $byLockStatus: LockStatusFilter, $byFlowID: [ID]) {\n  searchMintedMoments(input: {sortBy: $sortBy, filters: {byOwnerDapperID: $byOwnerDapperID, byOwnerFlowAddress: $byOwnerFlowAddress, bySets: $bySets, bySeries: $bySeries, bySetVisuals: $bySetVisuals, byLeagues: $byLeagues, byMomentTiers: $byMomentTiers, byPlayers: $byPlayers, byPlays: $byPlays, byTeams: $byTeams, byPlayCategory: $byPlayCategory, byPlayTagIDs: $byPlayTagIDs, bySetPlayTagIDs: $bySetPlayTagIDs, byPrimaryPlayerPosition: $byPrimaryPlayerPosition, byActiveChallenge: $byActiveChallenge, byEditions: $byEditions, byGroupSlug: $byGroupSlug, byPotentialTopshotScore: $byPotentialTopshotScore, byLockStatus: $byLockStatus, byFlowID: $byFlowID}, searchInput: $searchInput}) {\n    data {\n      sortBy\n      filters {\n        byOwnerDapperID\n        byOwnerFlowAddress\n        bySets\n        bySeries\n        bySetVisuals\n        byLeagues\n        byMomentTiers\n        byPlayers\n        byPlays\n        byTeams\n        byPlayCategory\n        byPlayTagIDs\n        bySetPlayTagIDs\n        byPrimaryPlayerPosition\n        byActiveChallenge\n        byEditions {\n          setID\n          playID\n          __typename\n        }\n        byGroupSlug\n        byLockStatus\n        byFlowID\n        __typename\n      }\n      searchSummary {\n        pagination {\n          leftCursor\n          rightCursor\n          __typename\n        }\n        data {\n          ... on MintedMoments {\n            size\n            data {\n              ...MomentDetails\n              __typename\n            }\n            __typename\n          }\n          __typename\n        }\n        __typename\n      }\n      __typename\n    }\n    __typename\n  }\n}\n\nfragment MomentDetails on MintedMoment {\n  id\n  version\n  sortID\n  tier\n  tags {\n    ...TagsFragment\n    __typename\n  }\n  set {\n    id\n    flowName\n    flowSeriesNumber\n    setVisualId\n    __typename\n  }\n  setPlay {\n    ID\n    flowRetired\n    tags {\n      ...TagsFragment\n      __typename\n    }\n    circulations {\n      ...CirculationsFragment\n      __typename\n    }\n    __typename\n  }\n  assetPathPrefix\n  play {\n    id\n    headline\n    headlineSource\n    stats {\n      playerID\n      playerName\n      firstName\n      lastName\n      primaryPosition\n      teamAtMomentNbaId\n      teamAtMoment\n      dateOfMoment\n      playCategory\n      jerseyNumber\n      nbaSeason\n      __typename\n    }\n    tags {\n      ...TagsFragment\n      __typename\n    }\n    league\n    __typename\n  }\n  price\n  listingOrderID\n  flowId\n  owner {\n    ...UserDetailsFragment\n    __typename\n  }\n  ownerV2 {\n    ...UserDetailsFragment\n    ...NonCustodialUserFragment\n    __typename\n  }\n  flowSerialNumber\n  forSale\n  userListingID\n  destroyedAt\n  acquiredAt\n  topshotScore {\n    score\n    derivedVia\n    calculatedAt\n    averageSalePrice\n    __typename\n  }\n  lastPurchasePrice\n  isLocked\n  lockExpiryAt\n  __typename\n}\n\nfragment TagsFragment on Tag {\n  id\n  title\n  visible\n  level\n  __typename\n}\n\nfragment CirculationsFragment on SetPlayCirculations {\n  burned\n  circulationCount\n  forSaleByCollectors\n  hiddenInPacks\n  ownedByCollectors\n  unavailableForPurchase\n  __typename\n}\n\nfragment UserDetailsFragment on User {\n  dapperID\n  username\n  profileImageUrl\n  __typename\n}\n\nfragment NonCustodialUserFragment on NonCustodialUser {\n  flowAddress\n  __typename\n}\n`

module.exports = {
  searchActivityQuery,
  getMomentsFromPacks,
  searchMintedMoments
}