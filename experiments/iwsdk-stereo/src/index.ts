// Application entry: Solid overlay, one IWSDK world.
import './style.css'
import { render } from 'solid-js/web'
import { App } from './app'

const dispose = render(App, document.getElementById('app')!)
if (import.meta.hot) import.meta.hot.dispose(dispose)
