import { Accordion } from "react-bootstrap";

const FAQ = [
  ["How are predictions made?", "Each team gets attack and defence strengths (home and away) from its recent results, weighting newer matches more. Those give expected goals for each side, turned into win/draw/loss and goals-market probabilities with a Poisson model. Small, bounded nudges account for recent form and head-to-head. The Model tab backtests it on past matches so you can judge it yourself."],
  ["What does the bet check do?", "Enter the odds a bookmaker offers. BetIQ compares them with the model's fair odds and shows the expected return per 1 staked. A positive number means the model rates the outcome more likely than the price implies. It is an estimate, not a guarantee."],
  ["Which competitions are covered?", "Every competition in the Bzzoiro Sports Data catalog (leagues and cups across the world), loaded in stages as the data sync runs. Open Competitions to browse; ones still loading are greyed out. Cup and international predictions are rougher because there are fewer matches per team."],
  ["Is the data live?", "No. Data refreshes every few hours, and match details you request are fetched within about 30 minutes. BetIQ is built for analysis before a match, not for following a game as it is played."],
  ["Why are some statistics, squads or profiles missing?", "The sync refreshes a few hundred teams per run, so a newly loaded competition fills in over a day or two. Lineups, events, shot maps and full player profiles are fetched on request: open a finished match or a player and tap the request button."],
  ["What are average positions and the shot map?", "They come from match tracking data. Average positions show where each player operated on average; the shot map shows every shot, sized by its expected goals (xG), with goals ringed."],
  ["Why can't I analyze a finished match?", "Betting analysis is for matches still to be played. Finished matches open a view-only page: the result, the pre-match prediction (using only data from before kickoff), statistics, events and teamsheets."],
  ["Bet responsibly", "Predictions are statistical estimates. Football is high-variance, and no model wins every bet. Only stake what you can afford to lose. 18+ only."],
];
export default function Help() {
  return (
    <div className="d-flex flex-column gap-3" style={{ maxWidth: 860 }}>
      <h1 className="h3 mb-0">Help</h1>
      <Accordion alwaysOpen>{FAQ.map(([q, a], i) => <Accordion.Item eventKey={String(i)} key={q}><Accordion.Header>{q}</Accordion.Header><Accordion.Body>{a}</Accordion.Body></Accordion.Item>)}</Accordion>
    </div>
  );
}
