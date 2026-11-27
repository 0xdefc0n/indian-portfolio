-- AMC disclosure scraper (plan §10.3.1, D10, M18). Public market data only: scheme ISINs, fund-house names and
-- the scheme names AMCs print in their disclosures. Nothing here links to a user, household or statement.
-- `fund_portfolio` (0001) gets rows with source 'amc'; `scrape_run` (0001) records every AMC run.

ALTER TABLE stock_match ADD COLUMN amc TEXT;          -- AMFI's fund-house name for it (scheme.amc), filled in by the job
ALTER TABLE stock_match ADD COLUMN amc_month TEXT;    -- YYYY-MM the last successful scrape of its AMC covered (matched or not)
ALTER TABLE stock_match ADD COLUMN amc_at INTEGER;    -- ms; a scrape of its AMC last ran for it, whatever the outcome
ALTER TABLE stock_match ADD COLUMN amc_scheme TEXT;   -- the disclosure's scheme name it matched; NULL = no match that month

CREATE INDEX stock_match_amc ON stock_match(amc);
CREATE INDEX scrape_run_at ON scrape_run(amc, at);
CREATE INDEX fund_portfolio_source ON fund_portfolio(scheme_isin, source, month);

INSERT INTO job_lock (name) VALUES ('amc');
