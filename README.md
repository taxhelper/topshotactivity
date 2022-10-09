# taxhelper/topshotactivity

This program outputs a detailed CSV file of your Top Shot activity, including:

- matching moments to packs
- estimating sale profit from moments from packs, as well as for gifted moments and traded in moments
- forex gains and losses based on your selected currency

It will save your detailed Topshot activity to a CSV file which has the following headers:
>`activity, date, subtotal_usd, fee_usd, total_usd, payment_method, payment_id, status, activity_type, brief_date, id, dapper_sale_fee_usd, dapper_sale_fee_to_currency, other_currency, usd_to_currency_rate, total_currency, json_data_id, item, player, play_category, team, flow_token_id, other_party_to_transactionId, other_party_to_transaction, main_data_source, order_id, moment_play_id, set_or_pack_ids, serial_number, activity_details, set_information, is_pack, pack_quantity, moment_general_path, moment_serial_path, moment_id, sale_profit_usd, sale_profit_currency, from_pack_id, days_held, account_balance, account_balance_currency, forex_realisation, forex_gain, selected_timezone, date_in_selected_timezone`

See comments at the bottom of this readme for more info.

If this program helps you, please consider sending a top shot gift to [jubilant_cornichons774o](https://nbatopshot.com/user/@jubilant_cornichons774o)

Note: This has been tested with my account that had around 1000 transactions. 

## DISCLAIMER - protect yourself

Only use this program running locally on your own computer and never provide your token details to anyone, even if they insist they can help you run this program.

This tool uses your top shot token to make direct api requests to NBA Top Shot to gather more information about your account. Note that this provides direct access to your account so you should make sure that you first trust this tool and only run it on your own computer and never share your token. 

For any open source tool, please review the code base to ensure that you trust and understand what it is doing.

## 1. Running from source code - How to set up the program ready to use

1. Download node.js (v14+) & npm - this program is written in node so you will need a copy of that on your computer. Visit https://nodejs.org/ to download and follow the install instructions and confirm that the install is working.

2. Download a copy of this repository by cloning or downloading a zip of this repository into a new folder on your computer.

3. Open a Terminal program and navigate to this folder.

4. Type `npm install` and press return/enter. This will install the required packages used in this program.

5. The program is now ready to run (with `npm run start`) but you need to gather some things - see list of requirements that follows.

## 2. Gather list of requirements

### - Top Shot Activity CSV

1. Visit your Dapper account on Top Shot and download a CSV file of all your Activity: [https://accounts.meetdapper.com/home](https://accounts.meetdapper.com/home)
2. Rename this CSV file to today's date (format: YYYYMMDD) and add it to the `files` directory, eg `./files/20220802.csv`

### - Top Shot Token (never share this with anyone)

This token is used to gather more detailed activity info from the Top Shot site itself.

1. Open a browser and navigate to the NBA Top Shot website. Make sure you are logged in.
2. In the same browser window, replace the url with this one [https://nbatopshot.com/api/auth0/session](https://nbatopshot.com/api/auth0/session)
3. Copy the value for `idToken` and have it ready when you run the program

### - Foreign Currency - optional
  If you want foreign currency conversions (and foreign currency gains/losses), you will need to set up a free account with [https://openexchangerates.org](https://openexchangerates.org) and have your App ID ready.
  This site lets you make a 1000 free requests per month. This program requests the exchange rate for a given day, and once retrieved, the rates are saved to a file and reused. As Top Shot hasn't existed for 1000 days yet, you won't go over your quota unless you run this program multiple times from different folders.

## Ready to run the program?

In the terminal, type `npm run start` and the program will run.

<img width="572" alt="Screen Shot 2022-10-05 at 9 18 25 am" src="https://user-images.githubusercontent.com/113106314/193945562-d7dd2210-2a84-4d26-a369-8ba6f8165789.png">

It will output a CSV of your records.

Once it completes, scroll up in the terminal to see any info about manually checking entries.

# Comments

I developed this tailored to my own activity so it may overlook certain circumstances.

- PACKS and MOMENTS:
  - Moments from packs have a "purchase price" which is equivalent to the cost of the pack divided by the number of moments in the pack
  - When the moment is sold, the sale profit is the sale price minus this "purchase price"
- TICKETS:
  - moments that are traded for tickets are treated as having been sold for $0
  - the purchase price of a Locker Room pack is treated as $0
  - any moments sold from a Locker Room pack are deemed to make a profit
  - ie:
    - trade in 4 x moments that were purchased for $2 each for tickets = loss of $8
    - purchase Locker Room pack = $0
    - gain 3 x $2 valued moments in pack. Sell them and make profit of $6.
  - note that the same applied for other ticket packs where traded in moments are treated as being sold for $0 and the pack itself costs $0.
- FOREIGN CURRENCY GAINS AND LOSSES: Dapper balance is treated akin to a bank account holding US dollars.
  - Deposits = sale profits, deposits, dapper balance gifts
  - Withdrawals = purchases, withdrawals from account
  - A forex realisation event happens on withdrawals
  - A first in, first out method is applied to work out foreign currency gains.
  - BASIC example:
    - Deposit of $1000 USD on 1 Jan 2021 (= $1,400 AUD on that date)
    - Withdrawal of $1000 USD on 4 March 2021 (= $1,300 AUD on that date)
      = Forex loss of $100 AUD
- OFFERS are not included in this program
