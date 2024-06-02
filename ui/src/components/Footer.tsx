import { SVGProps } from 'react'
import { JSX } from 'react/jsx-runtime'

const navigation = [
  {
    name: 'GitHub',
    href: 'https://github.com/TxnLab/reti',
    icon: (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
      <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    name: 'GitBook',
    href: 'https://txnlab.gitbook.io/reti-open-pooling',
    icon: (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => (
      <svg fill="currentColor" viewBox="0 0 32 32" {...props}>
        <path
          fillRule="evenodd"
          d="M31.2,14.2c-0.4-0.2-1-0.2-1.4,0l-11.6,6.7c-0.8,0.4-1.2,0.7-1.6,0.7c-0.4,0-0.8-0.2-1.6-0.7l-7.8-4.5 c-0.4-0.2-0.6-0.3-0.7-0.4c-0.4,0-0.7,0.2-0.8,0.5c-0.1,0.1-0.1,0.4-0.1,0.8c0,0.3,0,0.5,0,0.7c0.1,0.3,0.2,0.7,0.5,0.9 c0.1,0.1,0.3,0.2,0.6,0.4l8.4,4.8c0.8,0.5,1.2,0.7,1.6,0.7c0.4,0,0.8-0.2,1.6-0.7l10.3-5.9c0.3-0.2,0.4-0.2,0.5-0.2 c0.1,0.1,0.1,0.2,0.1,0.5v1.6c0,0.5,0,0.7-0.1,0.9c-0.1,0.2-0.3,0.3-0.7,0.5l-8.5,4.9c-1.6,0.9-2.3,1.4-3.2,1.4 c-0.9,0-1.6-0.5-3.2-1.4l-7.9-4.6l-0.1,0c-1.7-1-2.7-2.7-2.7-4.7v-1.5c0-1.1,0.6-2,1.5-2.6C5,12.5,6,12.5,6.8,13l6.6,3.8l0,0 c1.6,0.9,2.3,1.4,3.2,1.4c0.9,0,1.6-0.4,3.2-1.3l9.9-5.7c0.4-0.3,0.7-0.7,0.7-1.3s-0.3-1-0.7-1.3l-9.9-5.7c-1.6-0.9-2.3-1.3-3.2-1.3 c-0.9,0-1.6,0.5-3.2,1.3L4.9,7.8c-0.1,0-0.1,0.1-0.1,0.1C1.8,9.6,0,12.7,0,16v0.3c0,3.4,1.8,6.5,4.7,8.2l0.1,0.1l5.3,3.1 c3.1,1.8,4.7,2.7,6.4,2.7c1.7,0,3.3-0.9,6.4-2.7l5.6-3.3c1.6-0.9,2.3-1.4,2.8-2.1c0.4-0.7,0.4-1.6,0.4-3.4v-3.5 C31.9,14.9,31.6,14.5,31.2,14.2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
]

export function Footer() {
  return (
    <footer className="bg-background" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Footer
      </h2>
      <div className="mx-auto max-w-7xl mt-10 px-6 py-12 md:flex md:items-center md:justify-between lg:px-8">
        <div className="flex justify-center space-x-6 md:order-2">
          {navigation.map((item) => (
            <a
              key={item.name}
              href={item.href}
              className="text-muted-foreground hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="sr-only">{item.name}</span>
              <item.icon className="h-6 w-6" aria-hidden="true" />
            </a>
          ))}
        </div>
        <div className="mt-8 md:order-1 md:mt-0">
          <p className="text-center text-sm leading-5 text-stone-500">
            Réti Pooling v{__APP_VERSION__} <span className="mx-1 opacity-50">|</span>{' '}
            <a
              href="https://github.com/TxnLab/reti"
              className="link hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              TxnLab/reti
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
