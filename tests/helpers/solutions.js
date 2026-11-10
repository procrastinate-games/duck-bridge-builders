// Reference bridge designs per level, as the player would place them:
// each piece starts at `a` and ends at `b`. A point is [x, y] (an existing
// joint, or a free end), or { g: x } for an anchor on the ground at x.
// `reinforce` lists joints that get a connector (F).
// expect: 'hippo' (3 stars) | 'ducks' (2 stars, hippo falls) | 'fail' (duckling falls)

const deck = (y, xs, type = 'shortPlank') => xs.slice(0, -1).map((x, i) => ({ type, a: [x, y], b: [xs[i + 1], y] }));
const range = (from, to, step) => {
  const r = [];
  for (let x = from; x <= to + 1e-9; x += step) r.push(+x.toFixed(3));
  return r;
};

export const SOLUTIONS = {
  1: [
    {
      name: 'plank deck only',
      expect: 'ducks',
      pieces: deck(1, [-3, -1, 1, 3]),
    },
    {
      name: 'long plank + short plank',
      expect: 'ducks',
      pieces: [{ type: 'longPlank', a: [-3, 1], b: [1, 1] }, { type: 'shortPlank', a: [1, 1], b: [3, 1] }],
    },
    {
      name: 'deck on two posts',
      expect: 'hippo',
      pieces: [
        ...deck(1, [-3, -1, 1, 3]),
        { type: 'post', a: { g: -1 }, b: [-1, 1] },
        { type: 'post', a: { g: 1 }, b: [1, 1] },
      ],
      reinforce: [[-1, 1], [1, 1]],
    },
  ],
  2: [
    {
      name: 'two halves never joined',
      expect: 'fail',
      pieces: [
        ...deck(1.2, [-6, -4, -2, -0.4]),
        { type: 'shortPlank', a: [6, 1.2], b: [4, 1.2] },
        { type: 'shortPlank', a: [4, 1.2], b: [2, 1.2] },
        { type: 'shortPlank', a: [2, 1.2], b: [0.4, 1.2] },
      ],
    },
    {
      name: 'long plank deck only',
      expect: 'ducks',
      pieces: deck(1.2, [-6, -2, 2, 6], 'longPlank'),
    },
    {
      name: 'posts + rock struts',
      expect: 'hippo',
      pieces: [
        ...deck(1.2, range(-6, 6, 2)),
        { type: 'post', a: { g: -4 }, b: [-4, 1.2] },
        { type: 'post', a: { g: 4 }, b: [4, 1.2] },
        { type: 'post', a: { g: 0 }, b: [0, 1.2] },
        { type: 'beam', a: { g: -0.6 }, b: [-2, 1.2] },
        { type: 'beam', a: { g: 1.0 }, b: [2, 1.2] },
      ],
      reinforce: [[-4, 1.2], [-2, 1.2], [0, 1.2], [2, 1.2], [4, 1.2]],
    },
  ],
  3: [
    {
      name: 'plank deck only',
      expect: 'ducks',
      pieces: deck(4, range(-5, 5, 2)),
    },
    {
      name: 'ledge struts + king-post truss',
      expect: 'hippo',
      pieces: [
        ...deck(4, range(-5, 5, 2)),
        { type: 'beam', a: { g: -4.1 }, b: [-3, 4] },
        { type: 'beam', a: { g: 4.1 }, b: [3, 4] },
        { type: 'beam', a: [-3, 4], b: [-1, 2.6] },
        { type: 'beam', a: [3, 4], b: [1, 2.6] },
        { type: 'beam', a: [-1, 2.6], b: [1, 2.6] },
        { type: 'beam', a: [-1, 2.6], b: [-1, 4] },
        { type: 'beam', a: [1, 2.6], b: [1, 4] },
      ],
      reinforce: [[-3, 4], [-1, 4], [1, 4], [3, 4], [-1, 2.6], [1, 2.6], [-5, 4], [5, 4]],
    },
  ],
  4: [
    {
      name: 'plank deck only',
      expect: 'ducks',
      pieces: deck(4.5, range(-7, 7, 2)),
    },
    {
      name: 'pillar posts + side trusses',
      expect: 'hippo',
      pieces: [
        ...deck(4.5, range(-7, 7, 2)),
        { type: 'post', a: { g: -0.5 }, b: [-1, 4.5] },
        { type: 'post', a: { g: 0.5 }, b: [1, 4.5] },
        // Warren trusses above the deck (side rails)
        { type: 'beam', a: [-7, 4.5], b: [-6, 6.2] },
        { type: 'beam', a: [-6, 6.2], b: [-5, 4.5] },
        { type: 'beam', a: [-5, 4.5], b: [-4, 6.2] },
        { type: 'beam', a: [-4, 6.2], b: [-3, 4.5] },
        { type: 'beam', a: [-3, 4.5], b: [-2, 6.2] },
        { type: 'beam', a: [-2, 6.2], b: [-1, 4.5] },
        { type: 'beam', a: [-6, 6.2], b: [-4, 6.2] },
        { type: 'beam', a: [-4, 6.2], b: [-2, 6.2] },
        { type: 'beam', a: [7, 4.5], b: [6, 6.2] },
        { type: 'beam', a: [6, 6.2], b: [5, 4.5] },
        { type: 'beam', a: [5, 4.5], b: [4, 6.2] },
        { type: 'beam', a: [4, 6.2], b: [3, 4.5] },
        { type: 'beam', a: [3, 4.5], b: [2, 6.2] },
        { type: 'beam', a: [2, 6.2], b: [1, 4.5] },
        { type: 'beam', a: [6, 6.2], b: [4, 6.2] },
        { type: 'beam', a: [4, 6.2], b: [2, 6.2] },
      ],
      reinforce: [[-5, 4.5], [-3, 4.5], [-1, 4.5], [1, 4.5], [3, 4.5], [5, 4.5], [-6, 6.2], [-4, 6.2], [-2, 6.2], [6, 6.2], [4, 6.2], [2, 6.2], [-7, 4.5], [7, 4.5]],
    },
  ],
  5: [
    {
      name: 'plank deck only',
      expect: 'ducks',
      pieces: deck(1.8, range(-9, 9, 2)),
    },
    {
      name: 'islet posts + struts + king-post',
      expect: 'hippo',
      // built the way a player would: supports go in as the deck grows from each bank
      pieces: [
        { type: 'shortPlank', a: [-9, 1.8], b: [-7, 1.8] },
        { type: 'shortPlank', a: [-7, 1.8], b: [-5, 1.8] },
        { type: 'post', a: { g: -5 }, b: [-5, 1.8] },
        { type: 'beam', a: { g: -5.4 }, b: [-7, 1.8] },
        { type: 'shortPlank', a: [-5, 1.8], b: [-3, 1.8] },
        { type: 'beam', a: { g: -4.0 }, b: [-3, 1.8] },
        { type: 'shortPlank', a: [9, 1.8], b: [7, 1.8] },
        { type: 'shortPlank', a: [7, 1.8], b: [5, 1.8] },
        { type: 'post', a: { g: 5 }, b: [5, 1.8] },
        { type: 'beam', a: { g: 5.4 }, b: [7, 1.8] },
        { type: 'shortPlank', a: [5, 1.8], b: [3, 1.8] },
        { type: 'beam', a: { g: 4.0 }, b: [3, 1.8] },
        { type: 'shortPlank', a: [-3, 1.8], b: [-1, 1.8] },
        { type: 'shortPlank', a: [3, 1.8], b: [1, 1.8] },
        { type: 'beam', a: [-3, 1.8], b: [-1, 0.3] },
        { type: 'beam', a: [3, 1.8], b: [1, 0.3] },
        { type: 'beam', a: [-1, 0.3], b: [-1, 1.8] },
        { type: 'beam', a: [1, 0.3], b: [1, 1.8] },
        { type: 'beam', a: [-1, 0.3], b: [1, 0.3] },
        { type: 'shortPlank', a: [-1, 1.8], b: [1, 1.8] },
      ],
      reinforce: [[-7, 1.8], [-5, 1.8], [-3, 1.8], [-1, 1.8], [1, 1.8], [3, 1.8], [5, 1.8], [7, 1.8], [-1, 0.3], [1, 0.3], [-9, 1.8], [9, 1.8]],
    },
  ],
};
