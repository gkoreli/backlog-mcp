# nisli

A reactive web component framework. Signals, templates, dependency injection — no build step, no virtual DOM, no dependencies.

## Install

```bash
npm install nisli
```

## Quick Start

```typescript
import { signal, component, html } from 'nisli';

const Counter = component('x-counter', () => {
  const count = signal(0);
  return html`
    <button @click=${() => count.set(count() + 1)}>
      Count: ${count}
    </button>
  `;
});
```

## Features

- **Signals** — Fine-grained reactivity with `signal`, `computed`, `effect`
- **Components** — Web Components with reactive setup functions
- **Templates** — Tagged template literals with automatic signal binding
- **Dependency Injection** — `provide` / `inject` with typed tokens
- **Queries** — Declarative async data loading with caching
- **Event Emitters** — Typed custom event dispatching
- **Lifecycle** — `onMount`, `onCleanup`, `useHostEvent`
- **Refs** — Direct element access via `ref()`
- **Control Flow** — `when()` and `each()` for conditional and list rendering

## API

```typescript
// Reactivity
signal(value)           // Create a reactive signal
computed(() => expr)    // Derived signal
effect(() => { ... })   // Side effect that tracks dependencies

// Components
component('tag-name', setupFn)
component('tag-name', { props: [...], shadow: true }, setupFn)

// Templates
html`<div>${signal}</div>`
when(condition, () => html`...`)
each(items, (item) => html`...`)

// Dependency Injection
const Token = createToken<T>('name')
provide(Token, instance)
inject(Token)

// Queries
const { data, loading, error } = query(() => fetch(url))

// Lifecycle
onMount(() => { ... })
onCleanup(() => { ... })
useHostEvent('click', handler)

// Refs
const el = ref<HTMLDivElement>()
html`<div ${el}>...</div>`

// Events
const clicked = new Emitter<MouseEvent>(host, 'clicked')
clicked.emit(event)
```

## Size

~2,600 lines of TypeScript. Zero dependencies.

## Inspiration

nisli stands on the shoulders of giants:

- [React](https://react.dev) — Component model, declarative UI
- [Solid](https://www.solidjs.com) — Signals, fine-grained reactivity, no virtual DOM
- [Lit](https://lit.dev) — Web Components, tagged template literals
- [Angular](https://angular.dev) — Dependency injection, typed tokens
- [Vue](https://vuejs.org) — Composition-style setup functions, reactive system design

## License

MIT
