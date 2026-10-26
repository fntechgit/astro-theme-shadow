import ThemeFooter from '@fixture/theme/src/components/Footer'
import { links } from './links'

export default function Footer() {
  return (
    <div>
      site wrap of {links.length} links <ThemeFooter />
    </div>
  )
}
