// React 19's @types removed the global `JSX` namespace (it now lives at React.JSX).
// We use `: JSX.Element` return annotations, so re-expose it globally as an alias.
import type * as React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

export {}
