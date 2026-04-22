import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import App from './App.vue'

describe('App', () => {
  it('renders node summary, connect form, conversation list and composer shell', () => {
    const wrapper = mount(App, {
      props: {
        initialState: {
          node: {
            peerId: '12D3KooWlocal',
            addresses: ['/ip4/127.0.0.1/tcp/15002/ws'],
            connectionCount: 1
          },
          conversations: [
            {
              conversationId: 'peer:12D3KooWremote',
              title: '12D3KooWremote',
              updatedAt: 1760000000,
              lastMessageText: 'hello'
            }
          ],
          messagesByConversation: {
            'peer:12D3KooWremote': [
              {
                id: 'message-1',
                text: 'hello',
                from: '12D3KooWremote',
                status: 'received',
                ts: 1760000000
              }
            ]
          }
        }
      }
    })

    expect(wrapper.text()).toContain('P2P Chat')
    expect(wrapper.text()).toContain('12D3KooWlocal')
    expect(wrapper.text()).toContain('/ip4/127.0.0.1/tcp/15002/ws')
    expect(wrapper.text()).toContain('连接节点')
    expect(wrapper.text()).toContain('12D3KooWremote')
    expect(wrapper.text()).toContain('hello')
  })
})
