import katex from "katex";
import "katex/dist/katex.min.css";

const rootStyles = getComputedStyle(document.documentElement);
const cssToken = (name) => rootStyles.getPropertyValue(name).trim();
const DYNAMIC_COLOR = cssToken("--dynamic");
const INK_COLOR = cssToken("--ink");
const MUTED_COLOR = cssToken("--muted");
const LINE_COLOR = cssToken("--line");
const SOFT_LINE_COLOR = cssToken("--line-soft");
const CHART_BAND_COLOR = cssToken("--chart-band");
const CHART_CENTER_COLOR = cssToken("--chart-center");
const SERIF_FONT = cssToken("--serif");
const CHART_FONT = Object.freeze({
  title: `${cssToken("--type-content-heading")} ${SERIF_FONT}`,
  annotation: `${cssToken("--type-content-subheading")} ${SERIF_FONT}`,
});
const FAN_CHART_FONT = `${cssToken("--type-small")} ${SERIF_FONT}`;

const values = {
  mu: 0.05,
  r: 0.0375,
  sigma: 0.125,
  gamma: 3,
};

const DEFAULT_WEALTH_Y_MAXIMUM = 500;
const WEALTH_SCALE_EXPAND_THRESHOLD = 0.94;
const WEALTH_SCALE_SHRINK_THRESHOLD = 0.78;
let wealthFanYMaximum = DEFAULT_WEALTH_Y_MAXIMUM;
let wealthFanChartState;

const inputs = [...document.querySelectorAll("input[data-key]")];
const inputsByKey = new Map(inputs.map((input) => [input.dataset.key, input]));
const scenarioButtons = [...document.querySelectorAll("[data-scenario]")];
const inputBounds = Object.fromEntries(
  inputs.map((input) => [
    input.dataset.key,
    { minimum: Number(input.min), maximum: Number(input.max) },
  ]),
);
const controlsContainer = document.querySelector(".controls");
const controlElements = [...document.querySelectorAll("[data-control]")];
const contextualSections = [...document.querySelectorAll("[data-uses]")];
const wealthFanCanvas = document.getElementById("wealth-fan-chart");
const wealthFanTooltip = document.getElementById("wealth-fan-tooltip");

const ratePercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

const allocationPercent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const decimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const yearNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

const scenarioKeys = ["mu", "r", "sigma", "gamma"];
const scenarios = Object.fromEntries(
  scenarioButtons.map((button) => [
    button.dataset.scenario,
    Object.fromEntries(scenarioKeys.map((key) => [key, Number(button.dataset[key])])),
  ]),
);

for (const button of scenarioButtons) {
  const scenario = scenarios[button.dataset.scenario];
  button.querySelector(".scenario-values").textContent =
    `μ ${ratePercent.format(scenario.mu)} · r ${ratePercent.format(scenario.r)} · ` +
    `σ ${ratePercent.format(scenario.sigma)} · γ ${decimal.format(scenario.gamma)}`;
}

const staticEquations = {
  "objective-equation": String.raw`\max_{c,\pi}\;\mathbb{E}\!\left[\underbrace{\int_0^T e^{-\rho t}u(c_t)\,dt}_{\text{utility from consumption}}+\underbrace{\varepsilon^\gamma e^{-\rho T}u(W_T)}_{\text{utility from terminal wealth}}\right]`,
  "wealth-equation": String.raw`\underbrace{dW_t}_{\text{change in wealth}}=\overbrace{\underbrace{(rW_t-c_t)dt}_{\substack{\text{risk-free growth}\\\text{and consumption}}}+\underbrace{\pi_t(\mu-r)W_t\,dt}_{\text{reward from risky share}}}^{\text{expected change}}+\underbrace{W_t\pi_t\sigma\,dB_t}_{\text{random change}}`,
  "utility-equation": String.raw`\underbrace{u(x)}_{\text{utility of }x}=\frac{x^{1-\gamma}}{1-\gamma},\qquad \gamma\ne1.`,
  "tradeoff-equation": String.raw`\underbrace{\pi(\mu-r)}_{\text{expected reward}}-\underbrace{\frac{1}{2}\gamma\pi^2\sigma^2}_{\text{risk penalty}}`,
};

function renderLatex(id, expression, options = {}) {
  const element = document.getElementById(id);
  if (!element) return;
  katex.render(expression, element, {
    displayMode: true,
    throwOnError: false,
    strict: "ignore",
    ...options,
  });
}

function renderStaticMath() {
  for (const [id, expression] of Object.entries(staticEquations)) {
    renderLatex(id, expression);
  }
}

function latexValue(value) {
  return String(value).replaceAll("$", String.raw`\$`).replaceAll("%", String.raw`\%`);
}

function dynamicLatex(value) {
  return String.raw`\textcolor{${DYNAMIC_COLOR}}{${latexValue(value)}}`;
}

function adjustableLatex(key, value) {
  return String.raw`\htmlData{parameter=${key}}{${latexValue(value)}}`;
}

function dynamicText(value) {
  const span = document.createElement("span");
  span.className = "live-number";
  span.textContent = String(value);
  return span;
}

function renderLiveSentence(id, ...parts) {
  const element = document.getElementById(id);
  if (!element) return;
  element.replaceChildren(
    ...parts.map((part) => (typeof part === "string" ? document.createTextNode(part) : part)),
  );
}

function riskyShare() {
  return (values.mu - values.r) / (values.gamma * values.sigma ** 2);
}

function allocationDescription(share) {
  const risky = allocationPercent.format(Math.abs(share));

  if (Math.abs(share) < 0.005) {
    return ["The risky asset receives no meaningful allocation; wealth remains in the risk-free asset."];
  }

  if (share < 0) {
    return [
      "The solution shorts the risky asset by ",
      dynamicText(risky),
      " of wealth and holds ",
      dynamicText(allocationPercent.format(1 - share)),
      " in the risk-free asset.",
    ];
  }

  if (share <= 1) {
    return [
      "It invests ",
      dynamicText(allocationPercent.format(share)),
      " of wealth in the risky asset and keeps ",
      dynamicText(allocationPercent.format(1 - share)),
      " risk-free.",
    ];
  }

  return [
    "It invests ",
    dynamicText(allocationPercent.format(share)),
    " of wealth in the risky asset, financed by borrowing ",
    dynamicText(allocationPercent.format(share - 1)),
    " at the risk-free rate.",
  ];
}

function renderChart(optimalShare) {
  const svg = document.querySelector(".tradeoff-chart");
  const path = document.getElementById("tradeoff-path");
  const guide = document.getElementById("optimum-guide");
  const halo = document.getElementById("optimum-halo");
  const point = document.getElementById("optimum");
  const ticks = document.getElementById("chart-ticks");
  const zeroLine = document.getElementById("zero-line");

  if (!svg || !path || !guide || !halo || !point || !ticks || !zeroLine) {
    return;
  }

  const plot = { left: 62, right: 700, top: 14, bottom: 174 };
  const visibleOptimum = Math.max(0, optimalShare);
  const span = Math.max(1, visibleOptimum * 0.65);
  const xMin = 0;
  const xMax = Math.max(2, visibleOptimum + span);
  const objective = (share) =>
    share * (values.mu - values.r) -
    0.5 * values.gamma * share ** 2 * values.sigma ** 2;

  const samples = Array.from({ length: 121 }, (_, index) => {
    const share = xMin + (index / 120) * (xMax - xMin);
    return { share, value: objective(share) };
  });

  const yValues = samples.map(({ value }) => value);
  let yMin = Math.min(...yValues, 0);
  let yMax = Math.max(...yValues, 0);
  const yPadding = Math.max((yMax - yMin) * 0.15, 0.002);
  yMin -= yPadding;
  yMax += yPadding;

  const x = (share) =>
    plot.left + ((share - xMin) / (xMax - xMin)) * (plot.right - plot.left);
  const y = (value) =>
    plot.bottom - ((value - yMin) / (yMax - yMin)) * (plot.bottom - plot.top);

  path.setAttribute(
    "d",
    samples
      .map(({ share, value }, index) => `${index === 0 ? "M" : "L"} ${x(share)} ${y(value)}`)
      .join(" "),
  );

  zeroLine.setAttribute("x1", String(plot.left));
  zeroLine.setAttribute("x2", String(plot.right));
  zeroLine.setAttribute("y1", String(y(0)));
  zeroLine.setAttribute("y2", String(y(0)));

  ticks.replaceChildren();
  for (let index = 0; index <= 2; index += 1) {
    const share = xMin + (index / 2) * (xMax - xMin);
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tick.setAttribute("x", String(x(share)));
    tick.setAttribute("y", "198");
    tick.setAttribute("text-anchor", index === 0 ? "start" : index === 2 ? "end" : "middle");
    tick.textContent = allocationPercent.format(share);
    ticks.append(tick);
  }

  const pointX = x(visibleOptimum);
  const pointY = y(objective(visibleOptimum));
  guide.setAttribute("x1", String(pointX));
  guide.setAttribute("x2", String(pointX));
  guide.setAttribute("y1", String(pointY));
  guide.setAttribute("y2", String(plot.bottom));
  halo.setAttribute("cx", String(pointX));
  halo.setAttribute("cy", String(pointY));
  point.setAttribute("cx", String(pointX));
  point.setAttribute("cy", String(pointY));

  if (optimalShare < 0) {
    renderLiveSentence(
      "tradeoff-caption",
      "The unconstrained maximum, π∗ = ",
      dynamicText(allocationPercent.format(optimalShare)),
      ", lies to the left of this long-only plot.",
    );
  } else {
    renderLiveSentence(
      "tradeoff-caption",
      "The maximum occurs at π∗ = ",
      dynamicText(allocationPercent.format(optimalShare)),
      ".",
    );
  }
}

function nextWealthScale(scale) {
  const magnitude = 10 ** Math.floor(Math.log10(scale));
  const normalized = scale / magnitude;
  if (normalized < 2) return 2 * magnitude;
  if (normalized < 5) return 5 * magnitude;
  return 10 * magnitude;
}

function previousWealthScale(scale) {
  const magnitude = 10 ** Math.floor(Math.log10(scale));
  const normalized = scale / magnitude;
  if (normalized <= 1) return 5 * (magnitude / 10);
  if (normalized <= 2) return magnitude;
  return 2 * magnitude;
}

function renderWealthFanChart(portfolioReturn, portfolioVolatility) {
  const canvas = wealthFanCanvas;
  if (!canvas) return;
  hideWealthFanTooltip();

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const plot = { left: 42, right: width - 8, top: 30, bottom: height - 38 };
  const initialWealth = 100;
  const horizon = 10;
  const z50 = 0.67448975;
  const z90 = 1.64485363;
  const drift = portfolioReturn - 0.5 * portfolioVolatility ** 2;
  const projectedWealth = (year, zScore) =>
    initialWealth * Math.exp(drift * year + zScore * portfolioVolatility * Math.sqrt(year));
  const samples = Array.from({ length: 121 }, (_, index) => {
    const year = (index / 120) * horizon;
    return {
      year,
      median: projectedWealth(year, 0),
      lower50: projectedWealth(year, -z50),
      upper50: projectedWealth(year, z50),
      lower90: projectedWealth(year, -z90),
      upper90: projectedWealth(year, z90),
    };
  });
  const terminalSample = samples.at(-1);
  document.getElementById("wealth-fan-median").textContent = money.format(terminalSample.median);
  document.getElementById("wealth-fan-lower-50").textContent = money.format(terminalSample.lower50);
  document.getElementById("wealth-fan-upper-50").textContent = money.format(terminalSample.upper50);
  document.getElementById("wealth-fan-lower-90").textContent = money.format(terminalSample.lower90);
  document.getElementById("wealth-fan-upper-90").textContent = money.format(terminalSample.upper90);
  const maximumWealth = Math.max(initialWealth, ...samples.map(({ upper90 }) => upper90));
  while (maximumWealth > wealthFanYMaximum * WEALTH_SCALE_EXPAND_THRESHOLD) {
    wealthFanYMaximum = nextWealthScale(wealthFanYMaximum);
  }

  while (wealthFanYMaximum > DEFAULT_WEALTH_Y_MAXIMUM) {
    const smallerScale = Math.max(DEFAULT_WEALTH_Y_MAXIMUM, previousWealthScale(wealthFanYMaximum));
    if (maximumWealth >= smallerScale * WEALTH_SCALE_SHRINK_THRESHOLD) break;
    wealthFanYMaximum = smallerScale;
  }

  const yMaximum = wealthFanYMaximum;
  wealthFanChartState = { plot, samples };
  const x = (year) => plot.left + (year / horizon) * (plot.right - plot.left);
  const y = (wealth) => plot.bottom - (wealth / yMaximum) * (plot.bottom - plot.top);

  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.font = FAN_CHART_FONT;

  context.strokeStyle = SOFT_LINE_COLOR;
  context.lineWidth = 1;
  context.fillStyle = MUTED_COLOR;
  context.textBaseline = "middle";
  context.textAlign = "right";
  for (const tick of [0, yMaximum / 2, yMaximum]) {
    const tickY = y(tick);
    context.beginPath();
    context.moveTo(plot.left, tickY);
    context.lineTo(plot.right, tickY);
    context.stroke();
    context.fillText(compactMoney.format(tick), plot.left - 6, tickY);
  }

  const fillBand = (lowerKey, upperKey, color) => {
    context.fillStyle = color;
    context.beginPath();
    samples.forEach((sample, index) => {
      const command = index === 0 ? "moveTo" : "lineTo";
      context[command](x(sample.year), y(sample[upperKey]));
    });
    [...samples].reverse().forEach((sample) => {
      context.lineTo(x(sample.year), y(sample[lowerKey]));
    });
    context.closePath();
    context.fill();
  };

  fillBand("lower90", "upper90", CHART_BAND_COLOR);
  fillBand("lower50", "upper50", SOFT_LINE_COLOR);

  context.strokeStyle = DYNAMIC_COLOR;
  context.lineWidth = 1.5;
  context.beginPath();
  samples.forEach((sample, index) => {
    const command = index === 0 ? "moveTo" : "lineTo";
    context[command](x(sample.year), y(sample.median));
  });
  context.stroke();

  context.fillStyle = MUTED_COLOR;
  context.textBaseline = "top";
  for (const year of [0, 2, 4, 6, 8, 10]) {
    context.textAlign = year === 0 ? "left" : year === 10 ? "right" : "center";
    context.fillText(String(year), x(year), plot.bottom + 5);
  }
  context.textAlign = "center";
  context.fillText("years", (plot.left + plot.right) / 2, plot.bottom + 20);

  const legend = [
    { label: "90% range", color: CHART_BAND_COLOR, line: false },
    { label: "50% range", color: SOFT_LINE_COLOR, line: false },
    { label: "median", color: DYNAMIC_COLOR, line: true },
  ];
  let legendX = plot.left;
  context.textAlign = "left";
  context.textBaseline = "middle";
  for (const item of legend) {
    if (item.line) {
      context.strokeStyle = item.color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(legendX, 10);
      context.lineTo(legendX + 16, 10);
      context.stroke();
    } else {
      context.fillStyle = item.color;
      context.fillRect(legendX, 6, 16, 8);
    }
    context.fillStyle = MUTED_COLOR;
    context.fillText(item.label, legendX + 22, 10);
    legendX += 22 + context.measureText(item.label).width + 12;
  }
}

function renderSensitivityChart(currentShare) {
  const canvas = document.getElementById("sensitivity-chart");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const outer = 22;
  const columnGap = 26;
  const panelWidth = (width - outer * 2 - columnGap * 2) / 3;
  const shareMinimum = -0.5;
  const shareMaximum = 2;
  const specifications = [
    {
      label: "Excess return, μ − r",
      axisLabel: "μ − r",
      relationship: "π* ∝ μ − r",
      minimum: inputBounds.mu.minimum - inputBounds.r.maximum,
      maximum: inputBounds.mu.maximum - inputBounds.r.minimum,
      current: values.mu - values.r,
      format: ratePercent,
      share: (premium) => premium / (values.gamma * values.sigma ** 2),
    },
    {
      label: "Volatility, σ",
      axisLabel: "σ",
      relationship: "π* ∝ 1 / σ²",
      ...inputBounds.sigma,
      current: values.sigma,
      format: ratePercent,
      share: (sigma) => (values.mu - values.r) / (values.gamma * sigma ** 2),
    },
    {
      label: "Risk aversion, γ",
      axisLabel: "γ",
      relationship: "π* ∝ 1 / γ",
      ...inputBounds.gamma,
      current: values.gamma,
      format: decimal,
      share: (gamma) => (values.mu - values.r) / (gamma * values.sigma ** 2),
    },
  ];

  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";

  specifications.forEach((specification, panelIndex) => {
    const panelLeft = outer + panelIndex * (panelWidth + columnGap);
    const plot = {
      left: panelLeft + (panelIndex === 0 ? 60 : 12),
      right: panelLeft + panelWidth - 10,
      top: 78,
      bottom: height - 66,
    };
    const samples = Array.from({ length: 101 }, (_, index) => {
      const input = specification.minimum + (index / 100) * (specification.maximum - specification.minimum);
      return { input, share: specification.share(input) };
    });

    const x = (input) =>
      plot.left + ((input - specification.minimum) / (specification.maximum - specification.minimum)) * (plot.right - plot.left);
    const y = (share) =>
      plot.bottom - ((share - shareMinimum) / (shareMaximum - shareMinimum)) * (plot.bottom - plot.top);

    context.fillStyle = INK_COLOR;
    context.font = CHART_FONT.title;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText(specification.label, plot.left, 18);

    context.fillStyle = MUTED_COLOR;
    context.font = CHART_FONT.annotation;
    context.fillText(specification.relationship, plot.left, 45);

    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
    context.clip();

    context.fillStyle = CHART_BAND_COLOR;
    context.fillRect(plot.left, plot.top, plot.right - plot.left, y(1) - plot.top);
    context.fillStyle = CHART_CENTER_COLOR;
    context.fillRect(plot.left, y(0), plot.right - plot.left, plot.bottom - y(0));

    [-0.5, 0, 1, 2].forEach((share) => {
      context.strokeStyle = share === 0 || share === 1 ? LINE_COLOR : SOFT_LINE_COLOR;
      context.lineWidth = share === 0 || share === 1 ? 2 : 1;
      context.beginPath();
      context.moveTo(plot.left, y(share));
      context.lineTo(plot.right, y(share));
      context.stroke();
    });

    context.strokeStyle = INK_COLOR;
    context.lineWidth = 3;
    context.beginPath();
    samples.forEach(({ input, share }, index) => {
      if (index === 0) context.moveTo(x(input), y(share));
      else context.lineTo(x(input), y(share));
    });
    context.stroke();

    const currentX = x(specification.current);
    const displayedCurrentShare = Math.min(shareMaximum, Math.max(shareMinimum, currentShare));
    const currentY = y(displayedCurrentShare);
    context.fillStyle = DYNAMIC_COLOR;
    context.beginPath();
    if (currentShare > shareMaximum) {
      context.moveTo(currentX, currentY + 2);
      context.lineTo(currentX - 7, currentY + 13);
      context.lineTo(currentX + 7, currentY + 13);
      context.closePath();
    } else if (currentShare < shareMinimum) {
      context.moveTo(currentX, currentY - 2);
      context.lineTo(currentX - 7, currentY - 13);
      context.lineTo(currentX + 7, currentY - 13);
      context.closePath();
    } else {
      context.arc(currentX, currentY, 6, 0, Math.PI * 2);
    }
    context.fill();
    context.restore();

    if (panelIndex === 0) {
      context.fillStyle = MUTED_COLOR;
      context.font = CHART_FONT.annotation;
      context.textAlign = "right";
      context.textBaseline = "middle";
      [-0.5, 0, 1, 2].forEach((share) => {
        context.fillText(allocationPercent.format(share), plot.left - 9, y(share));
      });

      context.save();
      context.translate(panelLeft + 8, (plot.top + plot.bottom) / 2);
      context.rotate(-Math.PI / 2);
      context.textAlign = "center";
      context.fillText("risky share, π*", 0, 0);
      context.restore();
    }

    context.fillStyle = MUTED_COLOR;
    context.font = CHART_FONT.annotation;
    context.textBaseline = "top";
    context.textAlign = "left";
    context.fillText(specification.format.format(specification.minimum), plot.left, plot.bottom + 7);
    context.textAlign = "right";
    context.fillText(specification.format.format(specification.maximum), plot.right, plot.bottom + 7);

    context.font = CHART_FONT.annotation;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(specification.axisLabel, (plot.left + plot.right) / 2, height - 7);
  });
}

function hideWealthFanTooltip() {
  if (wealthFanTooltip) wealthFanTooltip.hidden = true;
}

function showWealthFanTooltip(event) {
  if (!wealthFanCanvas || !wealthFanTooltip || !wealthFanChartState) return;
  const canvasBounds = wealthFanCanvas.getBoundingClientRect();
  const chartX = event.clientX - canvasBounds.left;
  const chartY = event.clientY - canvasBounds.top;
  const { plot, samples } = wealthFanChartState;
  if (chartX < plot.left || chartX > plot.right || chartY < plot.top || chartY > plot.bottom) {
    hideWealthFanTooltip();
    return;
  }

  const progress = (chartX - plot.left) / (plot.right - plot.left);
  const sample = samples[Math.round(progress * (samples.length - 1))];
  document.getElementById("wealth-fan-tooltip-year").textContent = yearNumber.format(sample.year);
  document.getElementById("wealth-fan-tooltip-median").textContent = money.format(sample.median);
  document.getElementById("wealth-fan-tooltip-50").textContent =
    `${money.format(sample.lower50)}–${money.format(sample.upper50)}`;
  document.getElementById("wealth-fan-tooltip-90").textContent =
    `${money.format(sample.lower90)}–${money.format(sample.upper90)}`;

  const figureBounds = wealthFanCanvas.closest("figure").getBoundingClientRect();
  const pointerX = event.clientX - figureBounds.left;
  const pointerY = event.clientY - figureBounds.top;
  wealthFanTooltip.hidden = false;
  let left = pointerX + 12;
  let top = pointerY - wealthFanTooltip.offsetHeight - 10;
  if (left + wealthFanTooltip.offsetWidth > figureBounds.width) {
    left = pointerX - wealthFanTooltip.offsetWidth - 12;
  }
  if (top < 0) top = pointerY + 12;
  wealthFanTooltip.style.left = `${left}px`;
  wealthFanTooltip.style.top = `${top}px`;
}

function renderAdditionalModels(share) {
  const constrained = Math.min(1, Math.max(0, share));
  renderLatex(
    "constraint-equation",
    String.raw`\pi^*_{[0,1]}=\min\!\left(1,\max(0,\pi^*)\right)=${dynamicLatex(allocationPercent.format(constrained))}`,
  );
  if (share < 0) {
    renderLiveSentence(
      "constraint-explanation",
      "The unconstrained solution is ",
      dynamicText(allocationPercent.format(share)),
      ". Prohibiting short sales moves the allocation to 0%.",
    );
  } else if (share > 1) {
    renderLiveSentence(
      "constraint-explanation",
      "The unconstrained solution is ",
      dynamicText(allocationPercent.format(share)),
      ". Prohibiting leverage caps the risky allocation at 100%.",
    );
  } else {
    renderLiveSentence(
      "constraint-explanation",
      "The unconstrained solution, ",
      dynamicText(allocationPercent.format(share)),
      ", already lies between 0% and 100%, so the constraint does not change it.",
    );
  }

  document.getElementById("sensitivity-current-share").textContent = allocationPercent.format(share);

  renderSensitivityChart(share);
}

function activeScenario() {
  return Object.entries(scenarios).find(([, scenario]) =>
    Object.keys(values).every((key) => Math.abs(values[key] - scenario[key]) < 0.00001),
  )?.[0];
}

const mertonEquation = document.getElementById("merton-equation");
const scrubTooltip = document.getElementById("scrub-tooltip");
const scrubTooltipLabel = document.getElementById("scrub-tooltip-label");
const parameterNames = {
  mu: "Expected return",
  r: "Risk-free rate",
  sigma: "Volatility",
  gamma: "Risk aversion",
};
const parameterSymbols = {
  mu: "μ",
  r: "r",
  sigma: "σ",
  gamma: "γ",
};
let scrubState;

function parameterFormat(key, value) {
  return key === "gamma" ? decimal.format(value) : ratePercent.format(value);
}

function parameterElement(target, clientX, clientY) {
  const directElement = target instanceof Element ? target.closest("[data-parameter]") : undefined;
  if (directElement && mertonEquation?.contains(directElement)) return directElement;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return undefined;

  for (const layer of document.elementsFromPoint(clientX, clientY)) {
    const element = layer.closest("[data-parameter]");
    if (element && mertonEquation?.contains(element)) return element;
  }
  return undefined;
}

function decorateAdjustableNumbers() {
  for (const element of mertonEquation?.querySelectorAll("[data-parameter]") ?? []) {
    const key = element.dataset.parameter;
    const input = inputsByKey.get(key);
    if (!input) continue;

    element.setAttribute(
      "aria-label",
      `${parameterNames[key]}: ${parameterFormat(key, values[key])}. Drag to adjust.`,
    );
  }
}

function showScrubTooltip(element) {
  if (!scrubTooltip || !element) return;
  const key = element.dataset.parameter;
  const bounds = element.getBoundingClientRect();
  if (scrubTooltipLabel) scrubTooltipLabel.textContent = `${parameterSymbols[key]} ${parameterNames[key]}`;
  scrubTooltip.style.left = `${bounds.left + bounds.width / 2}px`;
  scrubTooltip.style.top = `${bounds.top}px`;
  scrubTooltip.hidden = false;
}

function hideScrubTooltip() {
  if (scrubTooltip) scrubTooltip.hidden = true;
}

function steppedValue(input, candidate) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const step = Number(input.step);
  const clamped = Math.min(maximum, Math.max(minimum, candidate));
  const stepped = minimum + Math.round((clamped - minimum) / step) * step;
  return Number(stepped.toFixed(8));
}

function setParameterValue(key, candidate) {
  const input = inputsByKey.get(key);
  if (!input) return;
  const nextValue = steppedValue(input, candidate);
  if (nextValue === values[key]) return;
  values[key] = nextValue;
  render();
}

function finishScrub() {
  scrubState = undefined;
  document.documentElement.classList.remove("is-scrubbing");
  hideScrubTooltip();
}

mertonEquation?.addEventListener("pointermove", (event) => {
  if (scrubState) return;
  const element = parameterElement(event.target, event.clientX, event.clientY);
  mertonEquation.classList.toggle("is-parameter-hovered", Boolean(element));
  if (element) showScrubTooltip(element);
  else hideScrubTooltip();
});

mertonEquation?.addEventListener("pointerleave", () => {
  if (scrubState) return;
  mertonEquation.classList.remove("is-parameter-hovered");
  hideScrubTooltip();
});

mertonEquation?.addEventListener("pointerdown", (event) => {
  const element = parameterElement(event.target, event.clientX, event.clientY);
  if (!element || (event.button !== undefined && event.button !== 0)) return;

  const key = element.dataset.parameter;
  const input = inputsByKey.get(key);
  if (!input) return;

  event.preventDefault();
  scrubState = {
    key,
    pointerId: event.pointerId,
    startX: event.clientX,
    startValue: values[key],
    width: Math.max(input.getBoundingClientRect().width, 1),
  };
  document.documentElement.classList.add("is-scrubbing");
  showScrubTooltip(element);
});

window.addEventListener("pointermove", (event) => {
  if (!scrubState || event.pointerId !== scrubState.pointerId) return;
  const input = inputsByKey.get(scrubState.key);
  if (!input) return;

  event.preventDefault();
  const range = Number(input.max) - Number(input.min);
  const candidate = scrubState.startValue + ((event.clientX - scrubState.startX) / scrubState.width) * range;
  setParameterValue(scrubState.key, candidate);
  showScrubTooltip(mertonEquation?.querySelector(`[data-parameter="${scrubState.key}"]`));
});

window.addEventListener("pointerup", (event) => {
  if (scrubState && event.pointerId === scrubState.pointerId) finishScrub();
});

window.addEventListener("pointercancel", (event) => {
  if (scrubState && event.pointerId === scrubState.pointerId) finishScrub();
});

window.addEventListener("blur", finishScrub);

function updateControlContext() {
  const focusLine = window.innerHeight * 0.38;
  const activeSection = contextualSections.find((section) => {
    const bounds = section.getBoundingClientRect();
    return bounds.top <= focusLine && bounds.bottom >= focusLine;
  });
  const activeKeys = activeSection?.dataset.uses.split(" ") ?? [];

  controlsContainer?.classList.toggle("contextual", activeKeys.length > 0);
  for (const control of controlElements) {
    control.classList.toggle("context-active", activeKeys.includes(control.dataset.control));
  }
}

let contextFrame;
function scheduleControlContext() {
  if (contextFrame) return;
  contextFrame = requestAnimationFrame(() => {
    updateControlContext();
    contextFrame = undefined;
  });
}

let wealthChartFrame;
function scheduleWealthChart() {
  if (wealthChartFrame) return;
  wealthChartFrame = requestAnimationFrame(() => {
    const share = riskyShare();
    renderWealthFanChart(values.r + share * (values.mu - values.r), Math.abs(share * values.sigma));
    wealthChartFrame = undefined;
  });
}

function render() {
  const share = riskyShare();
  const portfolioReturn = values.r + share * (values.mu - values.r);
  const portfolioVolatility = Math.abs(share * values.sigma);

  for (const input of inputs) {
    const key = input.dataset.key;
    input.value = String(values[key]);
    const minimum = Number(input.min);
    const maximum = Number(input.max);
    const fill = ((values[key] - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--fill", `${fill}%`);

    const output = document.getElementById(`${key}-output`);
    output.textContent = key === "gamma" ? decimal.format(values[key]) : ratePercent.format(values[key]);
  }

  document.getElementById("rail-share").textContent = allocationPercent.format(share);
  renderLatex(
    "merton-equation",
    String.raw`\underbrace{\pi^*(W,t)}_{\text{optimal risky share}}=\frac{\mu-r}{\sigma^2\gamma}=\frac{${adjustableLatex("mu", ratePercent.format(values.mu))}-${adjustableLatex("r", ratePercent.format(values.r))}}{\left(${adjustableLatex("sigma", ratePercent.format(values.sigma))}\right)^2\!\cdot${adjustableLatex("gamma", decimal.format(values.gamma))}}=${dynamicLatex(allocationPercent.format(share))}`,
    { trust: true },
  );
  decorateAdjustableNumbers();
  renderLiveSentence("allocation-sentence", ...allocationDescription(share));
  renderLatex(
    "portfolio-return-equation",
    String.raw`\underbrace{\mu_p}_{\text{expected return}}=r+\pi^*(\mu-r)=${dynamicLatex(ratePercent.format(portfolioReturn))}`,
  );
  renderLatex(
    "portfolio-volatility-equation",
    String.raw`\underbrace{\sigma_p}_{\text{portfolio volatility}}=|\pi^*|\sigma=${dynamicLatex(ratePercent.format(portfolioVolatility))}`,
  );

  const selectedScenario = activeScenario();
  for (const button of scenarioButtons) {
    button.classList.toggle("active", button.dataset.scenario === selectedScenario);
  }

  renderChart(share);
  renderWealthFanChart(portfolioReturn, portfolioVolatility);
  renderAdditionalModels(share);
}

for (const input of inputs) {
  input.addEventListener("input", () => {
    values[input.dataset.key] = Number(input.value);
    render();
  });
}

for (const button of scenarioButtons) {
  button.addEventListener("click", () => {
    Object.assign(values, scenarios[button.dataset.scenario]);
    render();
  });
}

wealthFanCanvas?.addEventListener("pointermove", showWealthFanTooltip);
wealthFanCanvas?.addEventListener("pointerleave", hideWealthFanTooltip);

renderStaticMath();
render();
updateControlContext();
window.addEventListener("scroll", scheduleControlContext, { passive: true });
window.addEventListener("resize", scheduleControlContext);
window.addEventListener("resize", scheduleWealthChart);
