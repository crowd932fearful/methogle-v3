"use strict";

const TOPICS = [
  "functions",
  "calculus",
  "trigonometry",
  "exponentials",
  "sequences",
  "probability",
  "statistics"
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function int(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick(rng, values) {
  return values[int(rng, 0, values.length - 1)];
}

function shuffle(rng, values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = int(rng, 0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function fraction(numerator, denominator) {
  if (denominator === 0) return "undefined";
  if (denominator < 0) {
    numerator *= -1;
    denominator *= -1;
  }
  const divisor = gcd(numerator, denominator);
  const n = numerator / divisor;
  const d = denominator / divisor;
  return d === 1 ? String(n) : `${n}/${d}`;
}

function number(value, decimals = 2) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(decimals)));
}

function signed(value) {
  return value >= 0 ? `+ ${value}` : `− ${Math.abs(value)}`;
}

function polynomialTerm(coefficient, power) {
  if (coefficient === 0) return "";
  const sign = coefficient < 0 ? "−" : "";
  const abs = Math.abs(coefficient);
  const c = abs === 1 && power > 0 ? "" : String(abs);
  if (power === 0) return `${sign}${abs}`;
  if (power === 1) return `${sign}${c}x`;
  return `${sign}${c}x${power === 2 ? "²" : power === 3 ? "³" : `^${power}`}`;
}

function polynomial(parts) {
  const terms = parts
    .filter(([coefficient]) => coefficient !== 0)
    .map(([coefficient, power]) => ({ coefficient, text: polynomialTerm(coefficient, power) }));
  if (!terms.length) return "0";
  return terms
    .map((term, index) => {
      if (index === 0) return term.text;
      return term.coefficient < 0
        ? ` − ${term.text.replace(/^−/, "")}`
        : ` + ${term.text}`;
    })
    .join("");
}

function uniqueStrings(values) {
  return [...new Set(values.map(String))];
}

function buildQuestion({ prompt, answer, distractors, explanation, topic, difficulty = 1, skill = "" }, rng) {
  const correct = String(answer);
  let options = uniqueStrings([correct, ...distractors]).filter((value) => value.trim() !== "");
  let bump = 1;
  while (options.length < 4) {
    const numeric = Number(correct);
    options.push(Number.isFinite(numeric) ? number(numeric + bump) : `Option ${options.length + 1}`);
    options = uniqueStrings(options);
    bump += 1;
  }
  options = shuffle(rng, options.slice(0, 4));
  return {
    id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    options,
    answerIndex: options.indexOf(correct),
    explanation,
    topic,
    difficulty: clamp(difficulty, 1, 5),
    skill
  };
}

function functionLinearValue(rng, difficulty) {
  const a = int(rng, difficulty > 2 ? -8 : -5, difficulty > 2 ? 8 : 5) || 2;
  const b = int(rng, -10, 10);
  const x = int(rng, -6, 6);
  const answer = a * x + b;
  return buildQuestion({
    prompt: `If f(x) = ${a}x ${signed(b)}, find f(${x}).`,
    answer,
    distractors: [a + x + b, a * x - b, answer + a],
    explanation: `Substitute x = ${x}: f(${x}) = ${a}(${x}) ${signed(b)} = ${answer}.`,
    topic: "functions",
    difficulty,
    skill: "Function evaluation"
  }, rng);
}

function functionComposite(rng, difficulty) {
  const a = int(rng, 2, 6);
  const b = int(rng, -6, 6);
  const c = int(rng, 2, 5);
  const d = int(rng, -5, 5);
  const x = int(rng, -4, 4);
  const gx = c * x + d;
  const answer = a * gx + b;
  return buildQuestion({
    prompt: `f(x) = ${a}x ${signed(b)} and g(x) = ${c}x ${signed(d)}. Find f(g(${x})).`,
    answer,
    distractors: [c * (a * x + b) + d, a * x + b + c * x + d, answer + a * c],
    explanation: `First g(${x}) = ${gx}. Then f(${gx}) = ${a}(${gx}) ${signed(b)} = ${answer}.`,
    topic: "functions",
    difficulty: Math.max(2, difficulty),
    skill: "Composite functions"
  }, rng);
}

function functionInverseLinear(rng, difficulty) {
  const a = pick(rng, [2, 3, 4, 5, -2, -3]);
  const b = int(rng, -8, 8);
  const y = int(rng, -5, 6);
  const output = a * y + b;
  return buildQuestion({
    prompt: `For f(x) = ${a}x ${signed(b)}, find f⁻¹(${output}).`,
    answer: y,
    distractors: [output * a + b, fraction(output - b, Math.abs(a)), y + a],
    explanation: `Solve ${output} = ${a}x ${signed(b)}. This gives x = (${output} − ${b})/${a} = ${y}.`,
    topic: "functions",
    difficulty: Math.max(2, difficulty),
    skill: "Inverse functions"
  }, rng);
}

function functionDomain(rng, difficulty) {
  const root = int(rng, -7, 7);
  const expression = root >= 0 ? `x − ${root}` : `x + ${Math.abs(root)}`;
  const answer = `x ≠ ${root}`;
  return buildQuestion({
    prompt: `State the domain restriction of f(x) = (2x + 1)/(${expression}).`,
    answer,
    distractors: [`x > ${root}`, `x < ${root}`, `x = ${root}`],
    explanation: `The denominator cannot equal zero, so ${expression} ≠ 0 and x ≠ ${root}.`,
    topic: "functions",
    difficulty: Math.max(2, difficulty),
    skill: "Domains"
  }, rng);
}

function calculusDerivativeAtPoint(rng, difficulty) {
  const a = int(rng, 1, 5);
  const b = int(rng, -7, 7);
  const c = int(rng, -8, 8);
  const x = int(rng, -4, 5);
  const answer = 2 * a * x + b;
  return buildQuestion({
    prompt: `For f(x) = ${polynomial([[a, 2], [b, 1], [c, 0]])}, find f′(${x}).`,
    answer,
    distractors: [a * x * x + b * x + c, 2 * a + b, answer + 2 * a],
    explanation: `f′(x) = ${2 * a}x ${signed(b)}. Therefore f′(${x}) = ${answer}.`,
    topic: "calculus",
    difficulty,
    skill: "Differentiation"
  }, rng);
}

function calculusCubicDerivative(rng, difficulty) {
  const a = int(rng, 1, 4);
  const b = int(rng, -5, 5);
  const c = int(rng, -6, 6);
  const x = int(rng, -3, 4);
  const answer = 3 * a * x * x + 2 * b * x + c;
  return buildQuestion({
    prompt: `If f(x) = ${polynomial([[a, 3], [b, 2], [c, 1]])}, find the gradient at x = ${x}.`,
    answer,
    distractors: [a * x * x * x + b * x * x + c * x, 3 * a * x + 2 * b + c, answer - c],
    explanation: `Differentiate: f′(x) = ${polynomial([[3 * a, 2], [2 * b, 1], [c, 0]])}. Substituting x = ${x} gives ${answer}.`,
    topic: "calculus",
    difficulty: Math.max(2, difficulty),
    skill: "Gradient of a curve"
  }, rng);
}

function calculusStationaryPoint(rng, difficulty) {
  const a = pick(rng, [1, 2, 3, -1, -2]);
  const h = int(rng, -5, 5);
  const b = -2 * a * h;
  const c = int(rng, -8, 8);
  return buildQuestion({
    prompt: `The function f(x) = ${polynomial([[a, 2], [b, 1], [c, 0]])} has a stationary point. What is its x-coordinate?`,
    answer: h,
    distractors: [-h, fraction(-b, a), h + a],
    explanation: `Set f′(x) = ${2 * a}x ${signed(b)} = 0. Hence x = ${h}.`,
    topic: "calculus",
    difficulty: Math.max(2, difficulty),
    skill: "Stationary points"
  }, rng);
}

function calculusDefiniteIntegral(rng, difficulty) {
  const a = int(rng, 1, 5);
  const b = int(rng, -5, 6);
  const upper = int(rng, 2, difficulty > 2 ? 6 : 4);
  const answer = (a * upper * upper) / 2 + b * upper;
  return buildQuestion({
    prompt: `Evaluate ∫₀^${upper} (${a}x ${signed(b)}) dx.`,
    answer: number(answer),
    distractors: [number(a * upper + b), number(a * upper * upper + b * upper), number(answer + upper)],
    explanation: `An antiderivative is (${a}/2)x² ${signed(b)}x. Evaluating from 0 to ${upper} gives ${number(answer)}.`,
    topic: "calculus",
    difficulty: Math.max(2, difficulty),
    skill: "Definite integrals"
  }, rng);
}

function calculusTangentEquation(rng, difficulty) {
  const a = int(rng, 1, 4);
  const h = int(rng, -3, 4);
  const k = int(rng, -5, 6);
  const m = 2 * a * h;
  const yIntercept = k - m * h;
  const answer = `y = ${m}x ${signed(yIntercept)}`;
  return buildQuestion({
    prompt: `For f(x) = ${a}x² ${signed(k - a * h * h)}, the point (${h}, ${k}) lies on the curve. Find the tangent equation at that point.`,
    answer,
    distractors: [`y = ${a * h}x ${signed(k - a * h * h)}`, `y = ${m}x ${signed(k)}`, `y = ${-m}x ${signed(yIntercept)}`],
    explanation: `The gradient is f′(${h}) = ${m}. Using y − ${k} = ${m}(x − ${h}) gives ${answer}.`,
    topic: "calculus",
    difficulty: Math.max(3, difficulty),
    skill: "Tangent equations"
  }, rng);
}

const TRIG_VALUES = [
  { fn: "sin", angle: 0, value: "0" },
  { fn: "sin", angle: 30, value: "1/2" },
  { fn: "sin", angle: 45, value: "√2/2" },
  { fn: "sin", angle: 60, value: "√3/2" },
  { fn: "sin", angle: 90, value: "1" },
  { fn: "cos", angle: 0, value: "1" },
  { fn: "cos", angle: 30, value: "√3/2" },
  { fn: "cos", angle: 45, value: "√2/2" },
  { fn: "cos", angle: 60, value: "1/2" },
  { fn: "cos", angle: 90, value: "0" },
  { fn: "tan", angle: 0, value: "0" },
  { fn: "tan", angle: 30, value: "√3/3" },
  { fn: "tan", angle: 45, value: "1" },
  { fn: "tan", angle: 60, value: "√3" }
];

function trigExactValue(rng, difficulty) {
  const item = pick(rng, TRIG_VALUES);
  const distractors = shuffle(rng, ["0", "1/2", "√2/2", "√3/2", "1", "√3", "√3/3"]).filter((x) => x !== item.value).slice(0, 3);
  return buildQuestion({
    prompt: `Find the exact value of ${item.fn}(${item.angle}°).`,
    answer: item.value,
    distractors,
    explanation: `${item.fn}(${item.angle}°) is a standard exact value: ${item.value}.`,
    topic: "trigonometry",
    difficulty,
    skill: "Exact trigonometric values"
  }, rng);
}

function trigAmplitudePeriod(rng, difficulty) {
  const amplitude = int(rng, 2, 7);
  const coefficient = pick(rng, [1, 2, 3, 4]);
  const period = 360 / coefficient;
  const askAmplitude = rng() < 0.5;
  return buildQuestion({
    prompt: `For y = ${amplitude}sin(${coefficient}x), what is the ${askAmplitude ? "amplitude" : "period in degrees"}?`,
    answer: askAmplitude ? amplitude : period,
    distractors: askAmplitude ? [coefficient, amplitude * 2, 360 / amplitude] : [360 * coefficient, coefficient, 180 / coefficient],
    explanation: askAmplitude
      ? `The amplitude is the absolute value of the coefficient outside sine: ${amplitude}.`
      : `The period is 360°/${coefficient} = ${period}°.` ,
    topic: "trigonometry",
    difficulty: Math.max(2, difficulty),
    skill: "Trigonometric graphs"
  }, rng);
}

function trigRadianConversion(rng, difficulty) {
  const pairs = [
    [30, "π/6"], [45, "π/4"], [60, "π/3"], [90, "π/2"],
    [120, "2π/3"], [135, "3π/4"], [150, "5π/6"], [180, "π"], [270, "3π/2"]
  ];
  const [degrees, radians] = pick(rng, pairs);
  return buildQuestion({
    prompt: `Convert ${degrees}° to radians.`,
    answer: radians,
    distractors: shuffle(rng, pairs.map(([, r]) => r).filter((r) => r !== radians)).slice(0, 3),
    explanation: `Multiply by π/180: ${degrees} × π/180 = ${radians}.`,
    topic: "trigonometry",
    difficulty: Math.max(2, difficulty),
    skill: "Radians"
  }, rng);
}

function trigSolveCount(rng, difficulty) {
  const type = rng() < 0.5 ? "sin" : "cos";
  const values = ["0", "1/2", "−1/2", "√2/2", "−√2/2"];
  const value = pick(rng, values);
  const count = value === "0" ? (type === "sin" ? 3 : 2) : 2;
  return buildQuestion({
    prompt: `How many solutions does ${type}(x) = ${value} have for 0° ≤ x ≤ 360°?`,
    answer: count,
    distractors: [1, 3, 4].filter((x) => x !== count),
    explanation: `${type}(x) = ${value} intersects the unit circle ${count} time${count === 1 ? "" : "s"} on the stated inclusive interval.`,
    topic: "trigonometry",
    difficulty: Math.max(3, difficulty),
    skill: "Trigonometric equations"
  }, rng);
}

function exponentialSolve(rng, difficulty) {
  const base = pick(rng, [2, 3, 4, 5]);
  const power = int(rng, 2, difficulty > 2 ? 6 : 4);
  const value = base ** power;
  return buildQuestion({
    prompt: `Solve ${base}ˣ = ${value}.`,
    answer: power,
    distractors: [power - 1, power + 1, base * power],
    explanation: `${value} = ${base}^${power}, so x = ${power}.`,
    topic: "exponentials",
    difficulty,
    skill: "Exponential equations"
  }, rng);
}

function logarithmEvaluate(rng, difficulty) {
  const base = pick(rng, [2, 3, 5, 10]);
  const power = int(rng, 1, 5);
  const value = base ** power;
  return buildQuestion({
    prompt: `Evaluate log₍${base}₎(${value}).`,
    answer: power,
    distractors: [base, value / base, power + 1],
    explanation: `Because ${base}^${power} = ${value}, log₍${base}₎(${value}) = ${power}.`,
    topic: "exponentials",
    difficulty,
    skill: "Logarithms"
  }, rng);
}

function logarithmLaw(rng, difficulty) {
  const a = int(rng, 2, 9);
  const b = int(rng, 2, 9);
  const product = a * b;
  return buildQuestion({
    prompt: `Simplify log(${a}) + log(${b}).`,
    answer: `log(${product})`,
    distractors: [`log(${a + b})`, `log(${a - b})`, `${product}log(10)`],
    explanation: `Using log A + log B = log(AB), the result is log(${a} × ${b}) = log(${product}).`,
    topic: "exponentials",
    difficulty: Math.max(2, difficulty),
    skill: "Log laws"
  }, rng);
}

function exponentialGrowth(rng, difficulty) {
  const initial = int(rng, 2, 9) * 100;
  const factor = pick(rng, [1.05, 1.1, 1.2, 1.5]);
  const periods = int(rng, 2, 4);
  const answer = initial * factor ** periods;
  return buildQuestion({
    prompt: `A quantity starts at ${initial} and grows by ${number((factor - 1) * 100)}% per period. What is its value after ${periods} periods?`,
    answer: number(answer),
    distractors: [number(initial * (1 + (factor - 1) * periods)), number(initial + factor * periods), number(answer / factor)],
    explanation: `Use exponential growth: ${initial}(${factor})^${periods} = ${number(answer)}.`,
    topic: "exponentials",
    difficulty: Math.max(2, difficulty),
    skill: "Exponential models"
  }, rng);
}

function sequenceArithmeticNth(rng, difficulty) {
  const first = int(rng, -5, 12);
  const difference = pick(rng, [-4, -3, -2, 2, 3, 4, 5]);
  const n = int(rng, 5, difficulty > 2 ? 16 : 10);
  const answer = first + (n - 1) * difference;
  return buildQuestion({
    prompt: `An arithmetic sequence has first term ${first} and common difference ${difference}. Find term ${n}.`,
    answer,
    distractors: [first + n * difference, first * difference * n, answer - difference],
    explanation: `Tₙ = a + (n − 1)d = ${first} + (${n} − 1)(${difference}) = ${answer}.`,
    topic: "sequences",
    difficulty,
    skill: "Arithmetic sequences"
  }, rng);
}

function sequenceArithmeticSum(rng, difficulty) {
  const first = int(rng, 1, 10);
  const difference = int(rng, 1, 6);
  const n = int(rng, 5, difficulty > 2 ? 14 : 10);
  const last = first + (n - 1) * difference;
  const answer = (n * (first + last)) / 2;
  return buildQuestion({
    prompt: `Find the sum of the first ${n} terms of an arithmetic sequence with first term ${first} and common difference ${difference}.`,
    answer,
    distractors: [n * (first + last), first + last, answer - last],
    explanation: `Sₙ = n/2(a + l) = ${n}/2(${first} + ${last}) = ${answer}.`,
    topic: "sequences",
    difficulty: Math.max(2, difficulty),
    skill: "Arithmetic series"
  }, rng);
}

function sequenceGeometricNth(rng, difficulty) {
  const first = int(rng, 1, 6);
  const ratio = pick(rng, [2, 3, -2]);
  const n = int(rng, 4, difficulty > 2 ? 7 : 5);
  const answer = first * ratio ** (n - 1);
  return buildQuestion({
    prompt: `A geometric sequence has first term ${first} and common ratio ${ratio}. Find term ${n}.`,
    answer,
    distractors: [first * ratio ** n, first + (n - 1) * ratio, answer / ratio],
    explanation: `Tₙ = arⁿ⁻¹ = ${first}(${ratio})^${n - 1} = ${answer}.`,
    topic: "sequences",
    difficulty: Math.max(2, difficulty),
    skill: "Geometric sequences"
  }, rng);
}

function sequenceInfiniteSum(rng, difficulty) {
  const denominator = pick(rng, [2, 3, 4, 5]);
  const numerator = int(rng, 1, denominator - 1);
  const ratio = numerator / denominator;
  const first = int(rng, 2, 12);
  const answer = first / (1 - ratio);
  return buildQuestion({
    prompt: `Find the sum to infinity of a geometric series with first term ${first} and ratio ${fraction(numerator, denominator)}.`,
    answer: number(answer),
    distractors: [number(first / (1 + ratio)), number(first * (1 - ratio)), number(answer - first)],
    explanation: `S∞ = a/(1 − r) = ${first}/(1 − ${fraction(numerator, denominator)}) = ${number(answer)}.`,
    topic: "sequences",
    difficulty: Math.max(3, difficulty),
    skill: "Infinite geometric series"
  }, rng);
}

function choose(n, r) {
  if (r < 0 || r > n) return 0;
  let result = 1;
  for (let i = 1; i <= r; i += 1) result = (result * (n - i + 1)) / i;
  return result;
}

function probabilityBinomial(rng, difficulty) {
  const n = int(rng, 3, difficulty > 2 ? 7 : 5);
  const k = int(rng, 0, n);
  const p = pick(rng, [0.2, 0.25, 0.4, 0.5, 0.6, 0.75]);
  const answer = choose(n, k) * p ** k * (1 - p) ** (n - k);
  return buildQuestion({
    prompt: `If X ~ Bin(${n}, ${p}), find P(X = ${k}) to 3 decimal places.`,
    answer: answer.toFixed(3),
    distractors: [(p ** k).toFixed(3), (choose(n, k) * p ** k).toFixed(3), (1 - answer).toFixed(3)],
    explanation: `P(X = ${k}) = C(${n},${k})(${p})^${k}(${number(1 - p)})^${n - k} = ${answer.toFixed(3)}.`,
    topic: "probability",
    difficulty: Math.max(3, difficulty),
    skill: "Binomial probability"
  }, rng);
}

function probabilityExpectedValue(rng, difficulty) {
  const n = int(rng, 4, 20);
  const p = pick(rng, [0.2, 0.25, 0.4, 0.5, 0.6, 0.75]);
  const answer = n * p;
  return buildQuestion({
    prompt: `If X ~ Bin(${n}, ${p}), find E(X).`,
    answer: number(answer),
    distractors: [number(n * (1 - p)), number(p), number(n * p * (1 - p))],
    explanation: `For a binomial random variable, E(X) = np = ${n}(${p}) = ${number(answer)}.`,
    topic: "probability",
    difficulty,
    skill: "Expected value"
  }, rng);
}

function probabilityComplement(rng, difficulty) {
  const probability = pick(rng, [0.12, 0.23, 0.35, 0.48, 0.62, 0.77]);
  const answer = 1 - probability;
  return buildQuestion({
    prompt: `If P(A) = ${probability}, find P(A′).`,
    answer: number(answer),
    distractors: [number(probability), number(1 + probability), number(probability / 2)],
    explanation: `A and A′ are complements, so P(A′) = 1 − ${probability} = ${number(answer)}.`,
    topic: "probability",
    difficulty,
    skill: "Complements"
  }, rng);
}

function probabilityConditional(rng, difficulty) {
  const totalB = int(rng, 8, 20);
  const both = int(rng, 2, totalB - 2);
  const answer = both / totalB;
  return buildQuestion({
    prompt: `In a group, ${totalB} students study Biology and ${both} study both Biology and Chemistry. Find P(Chemistry | Biology).`,
    answer: number(answer, 3),
    distractors: [number(both / (totalB + both), 3), number(totalB / both, 3), number(1 - answer, 3)],
    explanation: `P(C|B) = P(C ∩ B)/P(B), so using counts: ${both}/${totalB} = ${number(answer, 3)}.`,
    topic: "probability",
    difficulty: Math.max(2, difficulty),
    skill: "Conditional probability"
  }, rng);
}

function statisticsMean(rng, difficulty) {
  const count = difficulty > 2 ? 6 : 5;
  const targetMean = int(rng, 4, 16);
  const offsets = count === 5 ? [-4, -2, 0, 2, 4] : [-5, -3, -1, 1, 3, 5];
  const values = shuffle(rng, offsets.map((offset) => targetMean + offset));
  return buildQuestion({
    prompt: `Find the mean of: ${values.join(", ")}.`,
    answer: targetMean,
    distractors: [targetMean - 1, targetMean + 1, values[Math.floor(values.length / 2)]],
    explanation: `The values sum to ${targetMean * count}. Divide by ${count}: mean = ${targetMean}.`,
    topic: "statistics",
    difficulty,
    skill: "Mean"
  }, rng);
}

function statisticsZScore(rng, difficulty) {
  const mean = int(rng, 50, 80);
  const sd = pick(rng, [4, 5, 6, 8, 10]);
  const z = pick(rng, [-2, -1.5, -1, 1, 1.5, 2]);
  const x = mean + z * sd;
  return buildQuestion({
    prompt: `A distribution has mean ${mean} and standard deviation ${sd}. Find the z-score of x = ${number(x)}.`,
    answer: number(z),
    distractors: [number((x + mean) / sd), number(x - mean), number(sd / (x - mean))],
    explanation: `z = (x − μ)/σ = (${number(x)} − ${mean})/${sd} = ${number(z)}.`,
    topic: "statistics",
    difficulty: Math.max(2, difficulty),
    skill: "Z-scores"
  }, rng);
}

function statisticsVarianceBinomial(rng, difficulty) {
  const n = int(rng, 5, 20);
  const p = pick(rng, [0.2, 0.25, 0.4, 0.5, 0.6, 0.75]);
  const answer = n * p * (1 - p);
  return buildQuestion({
    prompt: `If X ~ Bin(${n}, ${p}), find Var(X).`,
    answer: number(answer),
    distractors: [number(n * p), number(n * (1 - p)), number(Math.sqrt(answer))],
    explanation: `Var(X) = np(1 − p) = ${n}(${p})(${number(1 - p)}) = ${number(answer)}.`,
    topic: "statistics",
    difficulty: Math.max(2, difficulty),
    skill: "Variance"
  }, rng);
}

function statisticsNormalRule(rng, difficulty) {
  const scenario = pick(rng, [
    { text: "within 1 standard deviation of the mean", answer: "68%", distractors: ["50%", "95%", "99.7%"] },
    { text: "within 2 standard deviations of the mean", answer: "95%", distractors: ["68%", "90%", "99.7%"] },
    { text: "within 3 standard deviations of the mean", answer: "99.7%", distractors: ["68%", "95%", "100%"] }
  ]);
  return buildQuestion({
    prompt: `For an approximately normal distribution, about what percentage lies ${scenario.text}?`,
    answer: scenario.answer,
    distractors: scenario.distractors,
    explanation: `The empirical 68–95–99.7 rule gives ${scenario.answer}.`,
    topic: "statistics",
    difficulty: Math.max(2, difficulty),
    skill: "Normal distribution"
  }, rng);
}

const GENERATORS = {
  functions: [functionLinearValue, functionComposite, functionInverseLinear, functionDomain],
  calculus: [calculusDerivativeAtPoint, calculusCubicDerivative, calculusStationaryPoint, calculusDefiniteIntegral, calculusTangentEquation],
  trigonometry: [trigExactValue, trigAmplitudePeriod, trigRadianConversion, trigSolveCount],
  exponentials: [exponentialSolve, logarithmEvaluate, logarithmLaw, exponentialGrowth],
  sequences: [sequenceArithmeticNth, sequenceArithmeticSum, sequenceGeometricNth, sequenceInfiniteSum],
  probability: [probabilityBinomial, probabilityExpectedValue, probabilityComplement, probabilityConditional],
  statistics: [statisticsMean, statisticsZScore, statisticsVarianceBinomial, statisticsNormalRule]
};

function stringSeed(input) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = typeof seed === "number" ? seed >>> 0 : stringSeed(seed);
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateQuestion({ topic = "mixed", difficulty = 1, rng = Math.random } = {}) {
  const resolvedTopic = topic === "mixed" || !GENERATORS[topic] ? pick(rng, TOPICS) : topic;
  const generator = pick(rng, GENERATORS[resolvedTopic]);
  return generator(rng, clamp(difficulty, 1, 5));
}

function generateQuestionSet({ topic = "mixed", count = 7, difficulty = 2, seed = null } = {}) {
  const rng = seed === null ? Math.random : seededRandom(seed);
  const questions = [];
  for (let i = 0; i < count; i += 1) {
    const rampedDifficulty = clamp(difficulty + Math.floor(i / 3), 1, 5);
    questions.push(generateQuestion({ topic, difficulty: rampedDifficulty, rng }));
  }
  return questions;
}

module.exports = {
  TOPICS,
  generateQuestion,
  generateQuestionSet,
  seededRandom
};
