/* Partsmith Markets — quote of the day (changes at midnight New York time).
   Short, well-documented quotes from well-known investors, with where each one comes from. */
const QUOTES = [
  { q: 'Price is what you pay; value is what you get.', who: 'Warren Buffett', src: 'quoting Benjamin Graham, 2008 Berkshire Hathaway letter' },
  { q: 'Be fearful when others are greedy and greedy when others are fearful.', who: 'Warren Buffett', src: '1986 Berkshire Hathaway letter' },
  { q: 'Our favorite holding period is forever.', who: 'Warren Buffett', src: '1988 Berkshire Hathaway letter' },
  { q: "If you aren't willing to own a stock for ten years, don't even think about owning it for ten minutes.", who: 'Warren Buffett', src: '1996 Berkshire Hathaway letter' },
  { q: "Only when the tide goes out do you discover who's been swimming naked.", who: 'Warren Buffett', src: '2001 Berkshire Hathaway letter' },
  { q: "Risk comes from not knowing what you're doing.", who: 'Warren Buffett', src: '' },
  { q: 'In the short run, the market is a voting machine but in the long run, it is a weighing machine.', who: 'Benjamin Graham', src: 'as retold by Warren Buffett' },
  { q: "The investor's chief problem—and even his worst enemy—is likely to be himself.", who: 'Benjamin Graham', src: 'The Intelligent Investor' },
  { q: "Don't look for the needle in the haystack. Just buy the haystack!", who: 'John C. Bogle', src: 'The Little Book of Common Sense Investing' },
  { q: 'Time is your friend; impulse is your enemy.', who: 'John C. Bogle', src: '' },
  { q: 'Know what you own, and know why you own it.', who: 'Peter Lynch', src: '' },
  { q: "Behind every stock is a company. Find out what it's doing.", who: 'Peter Lynch', src: '' },
  { q: 'Far more money has been lost by investors preparing for corrections, or trying to anticipate corrections, than has been lost in corrections themselves.', who: 'Peter Lynch', src: '' },
  { q: "The four most dangerous words in investing are: 'This time it's different.'", who: 'Sir John Templeton', src: '' },
  { q: 'Bull markets are born on pessimism, grow on skepticism, mature on optimism, and die on euphoria.', who: 'Sir John Templeton', src: '' },
  { q: 'The big money is not in the buying and selling, but in the waiting.', who: 'Charlie Munger', src: '' },
  { q: 'The first rule of compounding: Never interrupt it unnecessarily.', who: 'Charlie Munger', src: '' },
];

const bars = [...document.querySelectorAll('.quotebar')];   // main page + welcome screen
function dayIndex() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return Math.round(Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5);
}
let shown = null;
function render() {
  const d = dayIndex(); if (d === shown || !bars.length) return; shown = d;
  const x = QUOTES[((d * 7) % QUOTES.length + QUOTES.length) % QUOTES.length];   // step by 7 so authors mix day to day
  for (const bar of bars) {
    bar.innerHTML = `<span class="qb-label">Quote of the day</span><q class="qb-text"></q><span class="qb-who"></span>`;
    bar.querySelector('.qb-text').textContent = x.q;
    bar.querySelector('.qb-who').textContent = '— ' + x.who;
    bar.title = x.who + (x.src ? ', ' + x.src : '');
  }
}
render();
setInterval(render, 60000);   // switches over at midnight ET without a reload
