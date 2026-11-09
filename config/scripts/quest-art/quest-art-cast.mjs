// Quest's own cast, invented for Orca. No third-party character belongs here.

const skin = ['#f1c6a0', '#e6b48c', '#d9a077', '#b97f56', '#8a5a3c']

const hero = (look) => ({ boot: '#3a2a20', leg: '#3a3f55', skin: skin[0], ...look })

export const FIGURES_CAST = {
  lead: hero({
    body: '#2f5fb3',
    trim: '#f2c94c',
    cape: '#b3263a',
    hat: 'crown',
    tool: 'sword',
    hair: '#6a3f24',
    emblem: true
  }),
  advisor: hero({
    body: '#c79a2e',
    trim: '#fff1c2',
    cape: null,
    hat: 'wizard',
    tool: 'staff',
    robe: true,
    beard: '#efe9dc',
    skin: skin[1]
  }),
  members: [
    hero({
      body: '#aab4c4',
      trim: '#3f6fb5',
      cape: '#3a5b8c',
      hat: 'helm',
      tool: 'sword',
      leg: '#59647a',
      emblem: true
    }),
    hero({
      body: '#7c5234',
      trim: '#c23b34',
      cape: null,
      hat: 'band',
      tool: 'hammer',
      apron: '#3b2a1e',
      hair: '#2a1a12',
      skin: skin[2],
      beard: '#2a1a12',
      sleeve: '#c98f66'
    }),
    hero({
      body: '#3f8f5b',
      trim: '#c9a24b',
      cape: '#2b6143',
      hat: 'hood',
      tool: 'bow',
      leg: '#5b4630',
      skin: skin[1]
    }),
    hero({
      body: '#5b3fa8',
      trim: '#c7b3ff',
      cape: null,
      hat: 'wizard',
      tool: 'wand',
      robe: true,
      skin: skin[0],
      hair: '#c9b8a0'
    }),
    hero({
      body: '#b5332e',
      trim: '#f2c94c',
      cape: '#7a1f1c',
      hat: 'cap',
      tool: 'dagger',
      leg: '#3a2424',
      skin: skin[3]
    }),
    hero({
      body: '#e4dcc8',
      trim: '#3f8f8a',
      cape: null,
      hat: null,
      tool: 'staff',
      robe: true,
      hair: '#a85a2a',
      long: true,
      skin: skin[0]
    }),
    hero({
      body: '#2f7d86',
      trim: '#d8efe9',
      cape: '#1d4f55',
      hat: 'hood',
      tool: 'dagger',
      leg: '#29393c',
      skin: skin[4]
    }),
    hero({
      body: '#a8742e',
      trim: '#fbe3a8',
      cape: null,
      hat: 'cap',
      tool: 'sword',
      leg: '#4a3a24',
      skin: skin[2],
      hair: '#17120f'
    })
  ]
}

const worker = (look) => ({
  boot: '#20222c',
  leg: '#2e3442',
  skin: skin[0],
  seatedWork: true,
  brow: '#2a2024',
  ...look
})

export const OFFICE_CAST = {
  lead: worker({
    body: '#2b3a55',
    trim: '#20283c',
    sleeve: '#2b3a55',
    hair: '#4a2f1e',
    hat: 'mini',
    leg: '#232b3d'
  }),
  advisor: worker({
    body: '#d6a72f',
    trim: '#a97f1c',
    hair: '#7d7a78',
    skin: skin[1],
    leg: '#3a3a42',
    seatedWork: false
  }),
  members: [
    worker({ body: '#d9772f', trim: '#a95417', hair: '#17120f', skin: skin[4] }),
    worker({ body: '#8ea3bd', trim: '#6c8099', hair: '#1f1a1a', skin: skin[1] }),
    worker({ body: '#7a4fc0', trim: '#5a3596', hair: '#c9b8a0', long: true, skin: skin[0] }),
    worker({
      body: '#2f9a68',
      trim: '#1f7a50',
      hair: '#a85a2a',
      long: true,
      skin: skin[1],
      leg: '#4a3a2c'
    }),
    worker({ body: '#c7443e', trim: '#99302c', hair: '#2a1a12', skin: skin[3] }),
    worker({ body: '#e2dfd8', trim: '#b9b5ac', hair: '#6d6a68', skin: skin[2], beard: '#6d6a68' }),
    worker({ body: '#2f7d86', trim: '#1d5a62', hair: '#17120f', long: true, skin: skin[3] }),
    worker({ body: '#c58a3a', trim: '#99682a', hair: '#4a2f1e', skin: skin[0] })
  ]
}
