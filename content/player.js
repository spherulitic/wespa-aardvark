(() => {
  "use strict";

  /*
   * WESPA player profile with rating timeline.
   *
   * The v2 player endpoint contains official, server-stored endRating and
   * ratingChange values for every tournament. The displayed start rating is:
   *
   *     startRating = endRating - ratingChange
   *
   * No Glicko calculation is performed in the browser.
   */

  const API_BASE = String(window.WESPA_API_BASE || "/api").replace(/\/+$/, "");
  const PLAYER_ENDPOINT = (playerId) =>
    `${API_BASE}/v2/player/${encodeURIComponent(playerId)}`;
  const TOURNAMENT_ENDPOINT = (playerId, tourneyId) =>
    `${API_BASE}/v2/player/${encodeURIComponent(playerId)}/tournaments/${encodeURIComponent(tourneyId)}`;

  const state = {
    player: null,
    chart: null,
    allTimelinePoints: [],
    selectedRange: "all"
  };

  function getPlayerIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || params.get("player");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
  }

  function parseDateOnly(value) {
    if (!value) return null;

    const stringValue = String(value);
    const match = stringValue.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      const [, year, month, day] = match;
      const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), 12);
      return Number.isFinite(timestamp) ? timestamp : null;
    }

    const timestamp = Date.parse(stringValue);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function formatDate(value, options = {}) {
    const timestamp = typeof value === "number" ? value : parseDateOnly(value);
    if (!Number.isFinite(timestamp)) return "—";

    return new Intl.DateTimeFormat("en-GB", {
      day: options.short ? undefined : "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(new Date(timestamp));
  }

  function formatCompactDate(timestamp) {
    if (!Number.isFinite(timestamp)) return "";
    return new Intl.DateTimeFormat("en-GB", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC"
    }).format(new Date(timestamp));
  }

  function formatSigned(value) {
    const number = finiteNumber(value);
    if (number === null) return "—";
    return number > 0 ? `+${number}` : String(number);
  }

  function changeClass(value) {
    const number = finiteNumber(value);
    if (number === null || number === 0) return "neutral";
    return number > 0 ? "positive" : "negative";
  }

  function playerTitleBadge(title) {
    if (!title) return "";

    const titleMap = {
      M: "Master",
      IM: "International Master",
      GM: "Grandmaster"
    };

    const displayTitle = titleMap[title] || title;
    return `<span class="badge">${escapeHtml(displayTitle)}</span>`;
  }

  function normalizeTournament(rawTournament, index) {
    const endRating = finiteNumber(
      firstDefined(rawTournament.endRating, rawTournament.end_rating)
    );
    const ratingChange = finiteNumber(
      firstDefined(rawTournament.ratingChange, rawTournament.rating_change)
    );

    let startRating = finiteNumber(
      firstDefined(rawTournament.startRating, rawTournament.start_rating)
    );

    if (startRating === null && endRating !== null && ratingChange !== null) {
      startRating = endRating - ratingChange;
    }

    return {
      originalIndex: index,
      tourneyId: firstDefined(
        rawTournament.tourneyid,
        rawTournament.tourneyId,
        rawTournament.tournament_id,
        rawTournament.id
      ),
      name: firstDefined(
        rawTournament.name,
        rawTournament.tournamentName,
        rawTournament.tournament_name,
        "Unnamed tournament"
      ),
      date: firstDefined(rawTournament.date, rawTournament.end_date, rawTournament.start_date),
      timestamp: parseDateOnly(
        firstDefined(rawTournament.date, rawTournament.end_date, rawTournament.start_date)
      ),
      division: firstDefined(rawTournament.division, rawTournament.division_name, "—"),
      wins: finiteNumber(rawTournament.wins) ?? 0,
      losses: finiteNumber(rawTournament.losses) ?? 0,
      draws: finiteNumber(rawTournament.draws) ?? 0,
      spread: finiteNumber(rawTournament.spread),
      place: finiteNumber(firstDefined(rawTournament.place, rawTournament.rank)),
      startRating,
      endRating,
      ratingChange,
      startDeviation: finiteNumber(
        firstDefined(rawTournament.startDeviation, rawTournament.start_deviation)
      ),
      endDeviation: finiteNumber(
        firstDefined(rawTournament.endDeviation, rawTournament.end_deviation)
      )
    };
  }

  function normalizeTournaments(data) {
    const tournaments = Array.isArray(data?.tournaments) ? data.tournaments : [];

    return tournaments
      .map(normalizeTournament)
      .sort((a, b) => {
        const timeA = a.timestamp ?? Number.POSITIVE_INFINITY;
        const timeB = b.timestamp ?? Number.POSITIVE_INFINITY;
        if (timeA !== timeB) return timeA - timeB;

        const idA = Number(a.tourneyId);
        const idB = Number(b.tourneyId);
        if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB;

        return a.originalIndex - b.originalIndex;
      });
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText || "Request failed"}`);
    }

    return response.json();
  }

  async function fetchPlayer(playerId) {
    const data = await fetchJson(PLAYER_ENDPOINT(playerId));

    if (!data || !firstDefined(data.playerid, data.playerId)) {
      throw new Error("The API returned invalid player data.");
    }

    return {
      ...data,
      playerid: firstDefined(data.playerid, data.playerId),
      tournaments: normalizeTournaments(data)
    };
  }

  function renderPlayerHeader(data) {
    const countryCode = String(data.country || "UNK").toUpperCase();
    const flagUrl = `https://wespa.xerafin.net/flags/${encodeURIComponent(countryCode)}.png`;
    const fallbackPhoto =
      `https://ui-avatars.com/api/?name=${encodeURIComponent(data.name || "Player")}` +
      "&background=90b4d9&color=fff&rounded=true&size=160";
    const photoUrl = data.photourl || data.photoUrl || fallbackPhoto;

    return `
      <section class="card player-header">
        <div class="player-identity">
          <h1 class="player-name">
            ${escapeHtml(data.name || "Unknown player")}
            <span class="badge">
              <img
                src="${flagUrl}"
                alt=""
                onerror="this.style.display='none'"
              >
              ${escapeHtml(countryCode)}
            </span>
            ${playerTitleBadge(data.title)}
          </h1>

          <div class="player-meta">
            <span><i class="fa-solid fa-id-card"></i> WESPA ID: ${escapeHtml(data.playerid)}</span>
            <span><i class="fa-solid fa-chart-line"></i> Current rating: <strong>${escapeHtml(data.cswrating ?? "—")}</strong></span>
          </div>
        </div>

        <img
          class="player-photo"
          src="${escapeHtml(photoUrl)}"
          alt="${escapeHtml(data.name || "Player")}"
          onerror="this.src='${fallbackPhoto}'"
        >
      </section>
    `;
  }

  function statCard(label, value) {
    return `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${escapeHtml(value ?? "—")}</div>
      </div>
    `;
  }

  function renderStats(stats = {}) {
    const winLossDraw =
      `${finiteNumber(stats.wins) ?? 0} / ` +
      `${finiteNumber(stats.losses) ?? 0} / ` +
      `${finiteNumber(stats.draws) ?? 0}`;

    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h2><i class="fa-solid fa-chart-simple"></i> Career statistics</h2>
            <p>Statistics returned by the WESPA v2 player endpoint.</p>
          </div>
        </div>

        <div class="stats-grid">
          ${statCard("Games played", finiteNumber(stats.gamesPlayed) ?? 0)}
          ${statCard("Win / loss / draw", winLossDraw)}
          ${statCard("Win percentage", `${finiteNumber(stats.winPercentage) ?? 0}%`)}
          ${statCard("Average score", finiteNumber(stats.averageScore) ?? "—")}
          ${statCard("Average against", finiteNumber(stats.averageAgainst) ?? "—")}
          ${statCard("High game", finiteNumber(stats.highGame) ?? "—")}
          ${statCard("Low game", finiteNumber(stats.lowGame) ?? "—")}
          ${statCard("Largest spread", finiteNumber(stats.biggestWin) ?? "—")}
          ${statCard("High loss", finiteNumber(stats.highLoss) ?? "—")}
          ${statCard("Low win", finiteNumber(stats.lowWin) ?? "—")}
        </div>
      </section>
    `;
  }

  function buildTimelinePoints(tournaments) {
    const sameDayCount = new Map();

    return tournaments
      .filter((tournament) =>
        Number.isFinite(tournament.timestamp) &&
        tournament.endRating !== null
      )
      .map((tournament) => {
        const dayKey = String(tournament.timestamp);
        const sequence = sameDayCount.get(dayKey) || 0;
        sameDayCount.set(dayKey, sequence + 1);

        /*
         * A small same-day offset prevents multiple tournaments ending on the
         * same date from being drawn directly on top of one another.
         */
        const displayTimestamp = tournament.timestamp + sequence * 60 * 60 * 1000;

        return {
          x: displayTimestamp,
          y: tournament.endRating,
          dateTimestamp: tournament.timestamp,
          tournament: tournament.name,
          tourneyId: tournament.tourneyId,
          division: tournament.division,
          startRating: tournament.startRating,
          endRating: tournament.endRating,
          ratingChange: tournament.ratingChange,
          startDeviation: tournament.startDeviation,
          endDeviation: tournament.endDeviation
        };
      });
  }

  function timelineSummary(points, tournaments) {
    if (!points.length) return "";

    const earliestTournament = tournaments.find(
      (tournament) =>
        tournament.timestamp === points[0].dateTimestamp &&
        tournament.endRating === points[0].endRating
    );

    const firstStart = earliestTournament?.startRating ?? points[0].y;
    const latest = points.at(-1);
    const peak = points.reduce((best, point) => (point.y > best.y ? point : best), points[0]);
    const low = points.reduce((best, point) => (point.y < best.y ? point : best), points[0]);
    const netChange = latest.y - firstStart;

    const item = (label, value, cssClass = "") => `
      <div class="timeline-summary-item">
        <div class="timeline-summary-label">${escapeHtml(label)}</div>
        <div class="timeline-summary-value ${cssClass}">${escapeHtml(value)}</div>
      </div>
    `;

    return `
      <div class="timeline-summary">
        ${item("First recorded", firstStart)}
        ${item("Latest", latest.y)}
        ${item("Peak", `${peak.y} · ${formatDate(peak.dateTimestamp, { short: true })}`)}
        ${item("Lowest", `${low.y} · ${formatDate(low.dateTimestamp, { short: true })}`)}
        ${item("Net change", formatSigned(netChange), changeClass(netChange))}
      </div>
    `;
  }

  function renderTimelineSection(data) {
    const points = buildTimelinePoints(data.tournaments);
    state.allTimelinePoints = points;

    if (!points.length) {
      return `
        <section class="card timeline-card">
          <div class="section-heading">
            <div>
              <h2><i class="fa-solid fa-chart-line"></i> Rating history</h2>
              <p>Official ending rating after each recorded tournament.</p>
            </div>
          </div>
          <div class="timeline-empty">
            <div>
              <i class="fa-regular fa-chart-bar fa-2x"></i>
              <p>No tournament rating history is available for this player.</p>
            </div>
          </div>
        </section>
      `;
    }

    return `
      <section class="card timeline-card">
        <div class="section-heading">
          <div>
            <h2><i class="fa-solid fa-chart-line"></i> Rating history</h2>
            <p>
              Official server-stored ending rating after each tournament.
              Hover over a point for tournament details.
            </p>
          </div>

          <div class="timeline-controls" aria-label="Rating history period">
            <button class="range-button" type="button" data-range="1">1 year</button>
            <button class="range-button" type="button" data-range="2">2 years</button>
            <button class="range-button" type="button" data-range="5">5 years</button>
            <button class="range-button active" type="button" data-range="all">All</button>
          </div>
        </div>

        <div class="timeline-chart-wrap">
          <canvas id="ratingChart" aria-label="Player rating history line graph"></canvas>
        </div>

        ${timelineSummary(points, data.tournaments)}
      </section>
    `;
  }

  function renderTournamentRows(tournaments) {
    if (!tournaments.length) {
      return `
        <tr>
          <td colspan="10" style="text-align:center; color:#667b95; padding:28px;">
            No tournament history is available.
          </td>
        </tr>
      `;
    }

    return tournaments
      .slice()
      .reverse()
      .map((tournament, rowIndex) => {
        const detailsId = `details-${rowIndex}`;
        const tournamentHref = tournament.tourneyId
          ? `tournament.html?id=${encodeURIComponent(tournament.tourneyId)}`
          : "#";

        return `
          <tr class="data-row">
            <td class="nowrap">${formatDate(tournament.timestamp)}</td>
            <td class="tournament-name">
              <a href="${tournamentHref}">${escapeHtml(tournament.name)}</a>
            </td>
            <td>${escapeHtml(tournament.division)}</td>
            <td class="nowrap">
              ${tournament.wins}-${tournament.losses}-${tournament.draws}
            </td>
            <td class="numeric">${tournament.spread ?? "—"}</td>
            <td class="numeric">${tournament.place ?? "—"}</td>
            <td class="numeric">${tournament.startRating ?? "—"}</td>
            <td class="numeric ${changeClass(tournament.ratingChange)}">
              ${formatSigned(tournament.ratingChange)}
            </td>
            <td class="numeric"><strong>${tournament.endRating ?? "—"}</strong></td>
            <td>
              ${
                tournament.tourneyId
                  ? `<button
                       type="button"
                       class="detail-button"
                       data-details-id="${detailsId}"
                       data-tourney-id="${escapeHtml(tournament.tourneyId)}"
                     >Details</button>`
                  : "—"
              }
            </td>
          </tr>

          <tr class="details-row" id="${detailsId}">
            <td class="details-cell" colspan="10">
              <div class="details-content">Loading games...</div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderTournamentSection(data) {
    return `
      <section class="card">
        <div class="section-heading">
          <div>
            <h2><i class="fa-solid fa-trophy"></i> Tournament history</h2>
            <p>Most recent tournaments are shown first. Select Details for round-by-round results.</p>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th>Division</th>
                <th>W-L-D</th>
                <th class="numeric">Spread</th>
                <th class="numeric">Place</th>
                <th class="numeric">Start</th>
                <th class="numeric">Change</th>
                <th class="numeric">End</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${renderTournamentRows(data.tournaments)}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPage(data) {
    return `
      ${renderPlayerHeader(data)}
      ${renderStats(data.stats)}
      ${renderTimelineSection(data)}
      ${renderTournamentSection(data)}

      <div class="footer-note">
        <i class="fa-solid fa-database"></i>
        Data powered by WESPA API v2. Ratings shown are stored tournament ratings,
        not ratings recalculated by the browser.
      </div>
    `;
  }

  function createChart(points) {
    const canvas = document.getElementById("ratingChart");
    if (!canvas || !window.Chart || !points.length) return;

    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight);
    gradient.addColorStop(0, "rgba(31, 99, 146, 0.28)");
    gradient.addColorStop(1, "rgba(31, 99, 146, 0.02)");

    state.chart = new Chart(context, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Rating",
            data: points,
            parsing: false,
            borderColor: "#1f6392",
            backgroundColor: gradient,
            borderWidth: 3,
            fill: true,
            tension: 0.18,
            pointRadius: points.length > 80 ? 1.5 : 3,
            pointHoverRadius: 6,
            pointHitRadius: 12,
            pointBackgroundColor: "#ffffff",
            pointBorderColor: "#1f6392",
            pointBorderWidth: 2,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        normalized: true,
        interaction: {
          mode: "nearest",
          intersect: false,
          axis: "xy"
        },
        animation: {
          duration: 450
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            displayColors: false,
            padding: 12,
            callbacks: {
              title(items) {
                const point = items[0]?.raw;
                return point ? point.tournament : "";
              },
              label(item) {
                const point = item.raw;
                const lines = [
                  `Date: ${formatDate(point.dateTimestamp)}`,
                  `Rating: ${point.startRating ?? "—"} → ${point.endRating}`,
                  `Change: ${formatSigned(point.ratingChange)}`
                ];

                if (point.division && point.division !== "—") {
                  lines.push(`Division: ${point.division}`);
                }

                if (point.startDeviation !== null || point.endDeviation !== null) {
                  lines.push(
                    `Deviation: ${point.startDeviation ?? "—"} → ${point.endDeviation ?? "—"}`
                  );
                }

                return lines;
              }
            }
          },
          decimation: {
            enabled: true,
            algorithm: "lttb",
            samples: 250
          }
        },
        scales: {
          x: {
            type: "linear",
            grid: {
              color: "rgba(90, 110, 138, 0.10)"
            },
            ticks: {
              maxTicksLimit: 9,
              callback(value) {
                return formatCompactDate(Number(value));
              }
            },
            title: {
              display: true,
              text: "Tournament date"
            }
          },
          y: {
            grace: "8%",
            grid: {
              color: "rgba(90, 110, 138, 0.12)"
            },
            ticks: {
              precision: 0
            },
            title: {
              display: true,
              text: "WESPA rating"
            }
          }
        }
      }
    });
  }

  function filteredTimelinePoints(range) {
    if (range === "all") return state.allTimelinePoints.slice();

    const years = Number(range);
    if (!Number.isFinite(years) || !state.allTimelinePoints.length) {
      return state.allTimelinePoints.slice();
    }

    const latestTimestamp = state.allTimelinePoints.at(-1).dateTimestamp;
    const cutoff = new Date(latestTimestamp);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);

    return state.allTimelinePoints.filter(
      (point) => point.dateTimestamp >= cutoff.getTime()
    );
  }

  function applyTimelineRange(range) {
    state.selectedRange = range;

    document.querySelectorAll(".range-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.range === range);
    });

    if (!state.chart) return;

    const points = filteredTimelinePoints(range);
    state.chart.data.datasets[0].data = points;
    state.chart.data.datasets[0].pointRadius = points.length > 80 ? 1.5 : 3;
    state.chart.update();
  }

  function resultClass(result) {
    const normalized = String(result || "").toUpperCase();
    if (normalized === "W") return "result-win";
    if (normalized === "L") return "result-loss";
    if (normalized === "D") return "result-draw";
    if (normalized === "B") return "result-bye";
    return "";
  }

  function renderRounds(details) {
    const rounds = Array.isArray(details?.rounds)
      ? details.rounds
      : Array.isArray(details?.games)
        ? details.games
        : [];

    if (!rounds.length) {
      return `<div style="color:#667b95;">No round-by-round results are available.</div>`;
    }

    const rows = rounds
      .map((round) => {
        const opponentId = firstDefined(round.opponent_id, round.opponentId);
        const opponentName = firstDefined(
          round.opponent_name,
          round.opponentName,
          round.opponent,
          "—"
        );
        const opponentHtml = opponentId
          ? `<a href="player.html?id=${encodeURIComponent(opponentId)}">${escapeHtml(opponentName)}</a>`
          : escapeHtml(opponentName);

        const scoreFor = firstDefined(round.score_for, round.scoreFor, "—");
        const scoreAgainst = firstDefined(round.score_against, round.scoreAgainst, "—");
        const opponentRating = firstDefined(
          round.opponent_rating,
          round.opponentRating,
          "—"
        );
        const playerRatingAtTime = firstDefined(
          round.player_rating_at_time,
          round.playerRatingAtTime,
          "—"
        );
        const result = firstDefined(round.result, "—");

        return `
          <tr>
            <td class="numeric">${escapeHtml(firstDefined(round.round, round.round_number, "—"))}</td>
            <td>${opponentHtml}</td>
            <td class="numeric">${escapeHtml(opponentRating)}</td>
            <td class="${resultClass(result)}">${escapeHtml(result)}</td>
            <td class="numeric">${escapeHtml(scoreFor)}</td>
            <td class="numeric">${escapeHtml(scoreAgainst)}</td>
            <td class="numeric">${escapeHtml(playerRatingAtTime)}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="rounds-table">
        <table>
          <thead>
            <tr>
              <th class="numeric">Round</th>
              <th>Opponent</th>
              <th class="numeric">Opponent rating</th>
              <th>Result</th>
              <th class="numeric">For</th>
              <th class="numeric">Against</th>
              <th class="numeric">Player rating</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  async function toggleTournamentDetails(button) {
    const detailsRow = document.getElementById(button.dataset.detailsId);
    if (!detailsRow) return;

    if (detailsRow.classList.contains("open")) {
      detailsRow.classList.remove("open");
      button.textContent = "Details";
      return;
    }

    detailsRow.classList.add("open");
    button.textContent = "Hide";

    if (detailsRow.dataset.loaded === "true") return;

    button.disabled = true;
    const content = detailsRow.querySelector(".details-content");

    try {
      const details = await fetchJson(
        TOURNAMENT_ENDPOINT(state.player.playerid, button.dataset.tourneyId)
      );
      content.innerHTML = renderRounds(details);
      detailsRow.dataset.loaded = "true";
    } catch (error) {
      content.innerHTML = `
        <div class="error-box" style="margin:0;">
          Unable to load game details: ${escapeHtml(error.message)}
        </div>
      `;
    } finally {
      button.disabled = false;
    }
  }

  function attachEvents() {
    document.addEventListener("click", (event) => {
      const rangeButton = event.target.closest(".range-button");
      if (rangeButton) {
        applyTimelineRange(rangeButton.dataset.range);
        return;
      }

      const detailButton = event.target.closest(".detail-button");
      if (detailButton) {
        toggleTournamentDetails(detailButton);
      }
    });
  }

  function showError(error) {
    const loadingView = document.getElementById("loadingView");
    loadingView.innerHTML = `
      <div class="error-box">
        <strong><i class="fa-solid fa-circle-exclamation"></i> Player profile could not be loaded.</strong>
        <div style="margin-top:8px;">${escapeHtml(error.message)}</div>
      </div>
    `;
  }

  async function init() {
    const playerId = getPlayerIdFromUrl();

    if (!playerId || !/^\d+$/.test(playerId)) {
      showError(new Error("Add a numeric player ID to the URL, for example: player.html?id=757"));
      return;
    }

    try {
      const player = await fetchPlayer(playerId);
      state.player = player;

      const mainContent = document.getElementById("mainContent");
      mainContent.innerHTML = renderPage(player);
      mainContent.hidden = false;
      document.getElementById("loadingView").hidden = true;

      document.title = `${player.name || "Player"} | WESPA Player Profile`;
      createChart(state.allTimelinePoints);
      attachEvents();
    } catch (error) {
      console.error(error);
      showError(error);
    }
  }

  init();
})();
