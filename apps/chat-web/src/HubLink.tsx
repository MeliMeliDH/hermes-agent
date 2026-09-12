const HUB_URL = 'https://v2202609408706510466.tail617b2b.ts.net:8420'

interface HubLinkProps {
  className?: string
}

export function HubLink({ className = '' }: HubLinkProps) {
  const classes = ['button', 'hub-link', className].filter(Boolean).join(' ')

  return <a aria-label="Back to Apps Hub" className={classes} href={HUB_URL}>← Hub</a>
}
