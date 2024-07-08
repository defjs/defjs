import { Component, afterNextRender } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { isHttpResponseError } from '@defjs/core'
import { useGetUser } from '@lib/api/user'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: ` <router-outlet /> `,
  styles: [
    `
      :host {
        max-width: 1280px;
        margin: 0 auto;
        padding: 2rem;
        text-align: center;
      }
    `,
  ],
})
export class AppComponent {
  constructor() {
    afterNextRender(() => {
      this.initUser()
    })
  }

  async initUser() {
    const { doRequest } = useGetUser()
    try {
      const user = await doRequest()
      console.log(user)
    } catch (e) {
      if (isHttpResponseError(e)) {
        console.error(e.error)
      } else {
        console.error(e)
      }
    }
  }
}
