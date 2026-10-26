import clsx from 'clsx'
import { useState } from 'react'

export default function Toggle() {
  const [on, setOn] = useState(false)
  return (
    <button className={clsx('toggle', on && 'on')} onClick={() => setOn(!on)}>
      theme toggle {String(on)}
    </button>
  )
}
