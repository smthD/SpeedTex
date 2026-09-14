import type { Challenge, Difficulty, PracticeStyle } from './practice.ts';

/** Small expression tree: grouping is explicit, so composition never relies on
 * string substitution or accidental TeX precedence. Shapes omit symbol choices. */
interface Expression {
  tex: string;
  shape: string;
}
const node = (kind: string, tex: string, children: Expression[] = []): Expression => ({
  tex,
  shape: `${kind}(${children.map((x) => x.shape).join(',')})`,
});
const limits = {
  short: { budget: 2, length: 150 },
  standard: { budget: 6, length: 330 },
  extended: { budget: 12, length: 620 },
};

type Family =
  | 'calculus'
  | 'quantum'
  | 'vectors'
  | 'thermal'
  | 'operators'
  | 'waves'
  | 'mechanics'
  | 'tensors'
  | 'sets'
  | 'logic'
  | 'analysis'
  | 'topology'
  | 'series'
  | 'probability'
  | 'algebra'
  | 'maps'
  | 'piecewise';
const families: Record<PracticeStyle, Family[]> = {
  physics: [
    'calculus',
    'quantum',
    'vectors',
    'thermal',
    'operators',
    'waves',
    'mechanics',
    'tensors',
    'probability',
    'algebra',
    'series',
    'piecewise',
  ],
  mathematics: [
    'calculus',
    'sets',
    'logic',
    'analysis',
    'topology',
    'series',
    'probability',
    'algebra',
    'maps',
    'piecewise',
    'tensors',
  ],
};
const topics: Record<Family, string> = {
  calculus: 'Calculus',
  quantum: 'Quantum states',
  vectors: 'Vector calculus',
  thermal: 'Statistical mechanics',
  operators: 'Operator algebra',
  waves: 'Waves and transforms',
  mechanics: 'Analytical mechanics',
  tensors: 'Tensor notation',
  sets: 'Sets',
  logic: 'Logic',
  analysis: 'Analysis',
  topology: 'Topology',
  series: 'Series and products',
  probability: 'Probability',
  algebra: 'Linear algebra',
  maps: 'Maps and spaces',
  piecewise: 'Piecewise functions',
};

class Grammar {
  private random: () => number;
  readonly style: PracticeStyle;
  constructor(random: () => number, style: PracticeStyle) {
    this.random = random;
    this.style = style;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.random() * xs.length) % xs.length];
  }
  integer(low = 1, high = 5) {
    return low + Math.floor(this.random() * (high - low + 1));
  }
  variable() {
    return this.pick(['x', 'y', 'z', 't', 'r', 'u', 'v']);
  }
  index() {
    return this.pick(['i', 'j', 'k', 'n', 'm']);
  }
  greek() {
    return this.pick([
      '\\alpha',
      '\\beta',
      '\\gamma',
      '\\lambda',
      '\\omega',
      '\\theta',
      '\\sigma',
      '\\epsilon',
    ]);
  }
  field() {
    return this.pick(['\\mathbb{R}', '\\mathbb{C}', '\\mathbb{N}', '\\mathbb{Z}']);
  }
  set() {
    return this.pick(['A', 'B', 'U', 'V', 'X', 'Y']);
  }
  state() {
    return this.pick(['\\psi', '\\phi', '\\chi', '0', 'n']);
  }
  operator() {
    return `\\hat{${this.pick(['A', 'B', 'H', 'L', 'P', 'Q'])}}`;
  }
  call() {
    return `${this.pick(['f', 'g', 'h', 'F', '\\phi'])}(${this.variable()})`;
  }
  atom(): Expression {
    const kind = this.integer(0, 5);
    return node(
      `atom${kind}`,
      [
        this.variable(),
        this.greek(),
        String(this.integer()),
        this.call(),
        `${this.variable()}_{${this.index()}}`,
        this.style === 'physics' ? this.pick(['\\hbar', 'm', 'c', 'k_B']) : this.field(),
      ][kind],
    );
  }
  wrap(command: string, a: Expression) {
    return node(command, `${command}{${a.tex}}`, [a]);
  }
  binary(a: Expression, b: Expression, op: string) {
    return node(op, `\\left(${a.tex} ${op} ${b.tex}\\right)`, [a, b]);
  }
  fraction(a: Expression, b: Expression) {
    return node('frac', `\\frac{${a.tex}}{${b.tex}}`, [a, b]);
  }
  /** Budget counts internal nodes. Children divide it rather than multiply it. */
  expression(budget: number): Expression {
    if (budget <= 0) return this.atom();
    const kind = this.pick([
      'binary',
      'binary',
      'frac',
      'power',
      'root',
      'function',
      'sum',
      'integral',
      'derivative',
      'norm',
    ]);
    const left = this.integer(0, budget - 1);
    const a = () => this.expression(left),
      b = () => this.expression(budget - 1 - left);
    if (kind === 'binary') return this.binary(a(), b(), this.pick(['+', '-', '\\cdot', '\\times']));
    if (kind === 'frac') return this.fraction(a(), b());
    const inner = this.expression(budget - 1);
    switch (kind) {
      case 'power':
        return node(
          'power',
          `\\left(${inner.tex}\\right)^{${this.pick(['2', '3', '-1', this.greek()])}}`,
          [inner],
        );
      case 'root':
        return this.wrap(this.pick(['\\sqrt', '\\sqrt[3]']), inner);
      case 'function':
        return node(
          'function',
          `${this.pick(['\\sin', '\\cos', '\\tan', '\\log', '\\exp', '\\sinh'])}\\left(${inner.tex}\\right)`,
          [inner],
        );
      case 'sum':
        return this.aggregate(inner);
      case 'integral':
        return this.integral(inner);
      case 'derivative':
        return this.derivative(inner);
      default:
        return node(
          'norm',
          `\\left\\lVert ${inner.tex}\\right\\rVert_{${this.pick(['2', 'p', '\\infty'])}}`,
          [inner],
        );
    }
  }
  aggregate(a: Expression) {
    const op = this.pick(['\\sum', '\\prod']);
    return node(
      op,
      `${op}_{${this.index()}=${this.integer(0, 2)}}^{${this.pick(['N', '\\infty', String(this.integer(3, 9))])}} ${a.tex}`,
      [a],
    );
  }
  integral(a: Expression) {
    const x = this.variable(),
      op = this.pick(['\\int', '\\int', '\\oint']);
    const bounds = this.pick([
      `_{0}^{1}`,
      `_{-\\infty}^{\\infty}`,
      `_{0}^{${this.greek()}}`,
      `_{\\Gamma}`,
    ]);
    return node(
      op,
      `${op}${bounds} \\left(${a.tex}\\right)\\,${this.style === 'physics' ? `\\dd{${x}}` : `d${x}`}`,
      [a],
    );
  }
  derivative(a: Expression) {
    const x = this.variable(),
      partial = this.pick([true, false]);
    if (this.style === 'physics')
      return node(
        partial ? 'pdv' : 'dv',
        `${partial ? '\\pdv' : '\\dv'}${this.pick(['', '[2]'])}{${a.tex}}{${x}}`,
        [a],
      );
    return node(
      partial ? 'partial' : 'differential',
      `\\frac{${partial ? '\\partial' : 'd'}}{${partial ? '\\partial ' : 'd'}${x}}\\left(${a.tex}\\right)`,
      [a],
    );
  }
  matrix(budget: number) {
    const rows = this.integer(2, budget > 5 ? 3 : 2),
      cols = this.integer(1, 2);
    const cells = Array.from({ length: rows * cols }, () =>
      this.expression(Math.floor(budget / (rows * cols))),
    );
    const env = this.pick(['pmatrix', 'bmatrix', 'vmatrix']);
    const lines = Array.from({ length: rows }, (_, r) =>
      cells
        .slice(r * cols, (r + 1) * cols)
        .map((c) => c.tex)
        .join(' & '),
    );
    return node(
      `${env}${rows}x${cols}`,
      `\\begin{${env}}${lines.join(' \\\\ ')}\\end{${env}}`,
      cells,
    );
  }
  domain(family: Family, budget: number): Expression {
    const e = (b = budget) => this.expression(b);
    const x = this.variable(),
      i = this.index(),
      set = this.set();
    // Each family has multiple productions; every operand can itself be generated.
    switch (family) {
      case 'calculus':
        return this.pick([
          () => this.integral(e()),
          () => this.derivative(e()),
          () => {
            const a = e();
            return node(
              'mixed-partial',
              `\\frac{\\partial^{2}}{\\partial ${x}\\partial ${this.variable()}}\\left(${a.tex}\\right)`,
              [a],
            );
          },
        ])();
      case 'quantum': {
        const a = e(Math.max(0, budget - 1)),
          s = this.state(),
          t = this.state(),
          op = this.operator();
        return this.pick([
          () => node('matrix-element', `\\bra{${s}}${op}\\ket{${t}}`),
          () => node('state-sum', `\\sum_{${i}=0}^{N} ${a.tex}\\ket{${s}_{${i}}}`, [a]),
          () => node('outer-product', `\\ket{${s}}\\bra{${t}}`),
          () => node('quantum-overlap', `\\abs{\\braket{${s}}{${t}}}^{2}`),
          () => node('state-evolution', `e^{-i ${op} t/\\hbar}\\ket{${s}}`),
        ])();
      }
      case 'vectors': {
        const v = `\\vb{${this.pick(['E', 'B', 'F', 'A', 'v'])}}`,
          a = e();
        return this.pick([
          () => node('curl', `\\curl{${v}}`),
          () => node('divergence', `\\div{${v}}`),
          () => node('gradient', `\\grad{${a.tex}}`, [a]),
          () => node('laplacian', `\\nabla^{2}\\left(${a.tex}\\right)`, [a]),
          () => node('flux', `\\oiint_{\\partial ${set}} ${v}\\cdot\\dd{\\vb{S}}`),
          () => node('cross', `${v}\\times\\left(\\grad{${a.tex}}\\right)`, [a]),
        ])();
      }
      case 'thermal': {
        const a = e(Math.max(0, budget - 1));
        return this.pick([
          () => node('partition', `\\sum_{${i}=0}^{\\infty} e^{-\\beta E_{${i}}}`),
          () => node('trace', `\\Tr\\left(e^{-\\beta ${this.operator()}}\\right)`),
          () => node('entropy', `-k_B\\sum_{${i}=1}^{N}p_{${i}}\\log p_{${i}}`),
          () =>
            node(
              'thermal-average',
              `\\frac{1}{Z}\\sum_{${i}=0}^{N} ${a.tex} e^{-\\beta E_{${i}}}`,
              [a],
            ),
          () =>
            node('occupation', `\\frac{1}{e^{\\beta(${a.tex}-\\mu)} ${this.pick(['+', '-'])} 1}`, [
              a,
            ]),
        ])();
      }
      case 'operators': {
        const a = this.operator(),
          b = this.operator();
        return this.pick([
          () => node('commutator', `\\comm{${a}}{${b}}`),
          () => node('anticommutator', `\\acomm{${a}}{${b}}`),
          () => node('expectation', `\\expval{${a}^{${this.integer()}}}`),
          () => node('nested-commutator', `\\comm{${a}}{\\comm{${b}}{${this.operator()}}}`),
          () => node('adjoint', `${a}^{\\dagger}${b} - ${b}^{\\dagger}${a}`),
        ])();
      }
      case 'waves': {
        const a = e(Math.max(0, budget - 1));
        return this.pick([
          () => node('fourier', `\\int_{-\\infty}^{\\infty} ${a.tex} e^{-i k ${x}}\\,d${x}`, [a]),
          () =>
            node('laplace', `\\int_{0}^{\\infty} e^{-s ${x}}\\left(${a.tex}\\right)\\,d${x}`, [a]),
          () => node('wave', `${a.tex} e^{i(k ${x}-\\omega t)}`, [a]),
          () =>
            node(
              'wave-operator',
              `\\left(\\nabla^{2}-\\frac{1}{c^{2}}\\pdv[2]{}{t}\\right)${a.tex}`,
              [a],
            ),
        ])();
      }
      case 'mechanics':
        return this.pick([
          () => node('action', `\\int_{t_0}^{t_1} L(q,\\dot{q},t)\\,dt`),
          () => node('euler-lagrange', `\\dv{}{t}\\pdv{L}{\\dot{q}_{${i}}}-\\pdv{L}{q_{${i}}}`),
          () => node('hamiltonian', `\\sum_{${i}=1}^{N}p_{${i}}\\dot{q}_{${i}}-L`),
          () => {
            const a = e();
            return node('force', `-\\grad{${a.tex}}`, [a]);
          },
        ])();
      case 'tensors':
        return this.pick([
          () => node('contraction', `\\sum_{${i}=1}^{n} T^{${i}}{}_{${this.index()}}v_{${i}}`),
          () => node('metric', `g_{\\mu\\nu}\\,dx^{\\mu}\\,dx^{\\nu}`),
          () => node('tensor-product', `${set}\\otimes ${this.set()}`),
          () => node('covariant', `\\nabla_{\\mu}T^{\\mu\\nu}`),
          () => node('epsilon', `\\epsilon_{ijk}a^{j}b^{k}`),
        ])();
      case 'sets': {
        const a = e(Math.max(0, budget - 1));
        return this.pick([
          () => node('set-builder', `\\{${x}\\in ${this.field()}\\mid ${a.tex}>0\\}`, [a]),
          () =>
            node(
              'set-operation',
              `(${set} ${this.pick(['\\cup', '\\cap', '\\setminus', '\\triangle'])} ${this.set()})^{c}`,
            ),
          () =>
            node(
              'indexed-set',
              `${this.pick(['\\bigcup', '\\bigcap'])}_{${i}=1}^{\\infty}${set}_{${i}}`,
            ),
          () => node('power-set', `\\mathcal{P}(${set}\\times ${this.set()})`),
        ])();
      }
      case 'logic': {
        const predicate = (b: number): Expression => {
          if (b <= 0) return node('predicate', `${this.pick(['P', 'Q', 'R'])}(${this.variable()})`);
          if (this.pick([true, false])) {
            const a = predicate(b - 1);
            return node(
              'quantifier',
              `${this.pick(['\\forall', '\\exists'])} ${this.variable()}\\in ${this.field()}:\\;${a.tex}`,
              [a],
            );
          }
          const a = predicate(Math.floor((b - 1) / 2)),
            c = predicate(Math.ceil((b - 1) / 2));
          return this.binary(a, c, this.pick(['\\land', '\\lor', '\\implies', '\\iff']));
        };
        const a = predicate(Math.min(budget + 1, 5));
        return this.pick([a, this.wrap('\\neg', a)]);
      }
      case 'analysis': {
        const a = e();
        return this.pick([
          () => node('limit', `\\lim_{${x}\\to ${this.pick(['0', '\\infty', 'a'])}} ${a.tex}`, [a]),
          () =>
            node(
              'supremum',
              `${this.pick(['\\sup', '\\inf'])}_{${x}\\in ${set}}\\left(${a.tex}\\right)`,
              [a],
            ),
          () => node('limsup', `\\limsup_{${i}\\to\\infty} ${a.tex}`, [a]),
          () => node('absolute', `\\left|${a.tex}\\right|`, [a]),
        ])();
      }
      case 'topology':
        return this.pick([
          () => node('boundary', `\\partial ${set}`),
          () => node('closure', `\\overline{${set}}\\setminus ${set}^{\\circ}`),
          () =>
            node(
              'preimage',
              `f^{-1}\\left(${this.pick(['\\bigcup', '\\bigcap'])}_{${i}\\in I}U_{${i}}\\right)`,
            ),
          () => node('neighborhood', `B_{\\epsilon}(${x})\\cap ${set}`),
          () => node('topology-family', `\\mathcal{T}_{${set}}\\subseteq\\mathcal{P}(${set})`),
        ])();
      case 'series':
        return this.aggregate(e());
      case 'probability': {
        const a = e(Math.max(0, budget - 1));
        return this.pick([
          () => node('conditional', `\\mathbb{P}(${set}\\mid ${this.set()})`),
          () => node('expectation', `\\mathbb{E}\\left[${a.tex}\\right]`, [a]),
          () => node('variance', `\\operatorname{Var}\\left(${a.tex}\\right)`, [a]),
          () =>
            node(
              'density',
              `\\frac{1}{\\sigma\\sqrt{2\\pi}}e^{-\\frac{(${x}-\\mu)^2}{2\\sigma^2}}`,
            ),
          () => node('binomial', `\\binom{n}{${i}}p^{${i}}(1-p)^{n-${i}}`),
        ])();
      }
      case 'algebra':
        return this.pick([
          () => this.matrix(budget),
          () => node('determinant', `\\det(${set}-${this.greek()} I)`),
          () => node('kernel', `\\ker(${set})\\oplus\\operatorname{im}(${set})`),
          () => node('inner-product', `\\langle ${this.variable()},${this.variable()}\\rangle`),
          () => node('matrix-power', `${set}^{${this.pick(['T', '-1', '\\dagger'])}}${this.set()}`),
        ])();
      case 'maps':
        return this.pick([
          () => node('map', `f:${set}\\longrightarrow ${this.field()}`),
          () => {
            const a = e();
            return node('maps-to', `${x}\\longmapsto ${a.tex}`, [a]);
          },
          () => node('composition', `(f\\circ g)(${x})`),
          () => node('quotient', `${this.field()}^{${this.integer(2, 5)}}/\\sim`),
          () => node('function-space', `C^{${this.integer()}}(${set},${this.field()})`),
        ])();
      case 'piecewise': {
        const count = budget > 5 ? this.integer(2, 3) : 2;
        const children = Array.from({ length: count }, () => e(Math.floor(budget / count)));
        const conditions = [`${x}<0`, `${x}\\geq 0`, `${x}\\in ${set}`];
        return node(
          `cases${count}`,
          `\\begin{cases}${children.map((a, j) => `${a.tex} & ${conditions[j]}`).join(' \\\\ ')}\\end{cases}`,
          children,
        );
      }
    }
  }
  equation(family: Family, difficulty: Difficulty): Expression {
    const budget = limits[difficulty].budget;
    const form = this.pick(
      difficulty === 'short'
        ? ['identity', 'standalone', 'relation']
        : difficulty === 'standard'
          ? ['identity', 'relation', 'balance', 'definition', 'standalone']
          : ['balance', 'chain', 'system', 'relation', 'definition'],
    );
    const domain = (b: number) => this.domain(family, b);
    const relation = () => this.pick(['=', '=', '\\simeq', '\\leq', '\\geq', '\\propto']);
    const join = (kind: string, a: Expression, b: Expression, op: string) =>
      node(kind, `${a.tex} ${op} ${b.tex}`, [a, b]);
    if (form === 'standalone') return domain(budget);
    if (form === 'identity')
      return join(
        form,
        domain(Math.floor(budget / 2)),
        this.expression(Math.floor(budget / 2)),
        '=',
      );
    if (form === 'definition')
      return join(
        form,
        node('name', `${this.pick(['F', 'G', '\\Phi', '\\mathcal{L}'])}(${this.variable()})`),
        domain(budget),
        ':=',
      );
    if (form === 'relation')
      return join(form, domain(Math.floor(budget / 2)), domain(Math.floor(budget / 2)), relation());
    if (form === 'balance')
      return join(
        form,
        domain(Math.floor(budget / 3)),
        this.binary(
          domain(Math.floor(budget / 3)),
          this.expression(Math.floor(budget / 3)),
          this.pick(['+', '-']),
        ),
        '=',
      );
    const a = domain(Math.floor(budget / 3)),
      b = this.expression(Math.floor(budget / 3)),
      c = domain(Math.floor(budget / 3));
    if (form === 'chain')
      return node(form, `${a.tex} ${relation()} ${b.tex} ${relation()} ${c.tex}`, [a, b, c]);
    return node(
      form,
      `\\begin{aligned}${a.tex} &= ${b.tex} \\\\ ${this.call()} &= ${c.tex}\\end{aligned}`,
      [a, b, c],
    );
  }
}

let challengeSequence = 0;

/** Stateless API for reproducible generation with an injected RNG. */
export function generateChallenge(
  style: PracticeStyle,
  difficulty: Difficulty,
  random = Math.random,
): Challenge {
  return createChallengeGenerator(random)(style, difficulty);
}

/** One instance per practice workspace. Least-recent topics and structural
 * fingerprints are independent per style/length; bounded retries never stall UI. */
export function createChallengeGenerator(random: () => number = () => Math.random()) {
  const histories = new Map<string, { topics: Family[]; shapes: string[] }>();
  return (style: PracticeStyle, difficulty: Difficulty): Challenge => {
    const key = `${style}:${difficulty}`;
    const history = histories.get(key) || { topics: [], shapes: [] };
    const grammar = new Grammar(random, style);
    const available = families[style].filter((f) => !history.topics.includes(f));
    const family = grammar.pick(available);
    let expression!: Expression;
    for (let attempt = 0; attempt < 24; attempt++) {
      expression = grammar.equation(family, difficulty);
      if (
        expression.tex.length <= limits[difficulty].length &&
        !history.shapes.includes(expression.shape)
      )
        break;
    }
    // A degenerate RNG must still terminate and obey the size cap.
    if (expression.tex.length > limits[difficulty].length)
      expression = grammar.equation(family, 'short');
    history.topics.push(family);
    if (history.topics.length > Math.floor(families[style].length / 2)) history.topics.shift();
    history.shapes.push(expression.shape);
    if (history.shapes.length > 40) history.shapes.shift();
    histories.set(key, history);
    return {
      id: `${Date.now().toString(36)}-${++challengeSequence}-${random().toString(36).slice(2)}`,
      style,
      difficulty,
      topic: topics[family],
      tex: expression.tex,
    };
  };
}
