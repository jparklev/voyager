function r (pageName) { return require(`components/Page${pageName}`) }

export default [
  {
    path: '/',
    name: 'validators',
    component: r('Validators')
  },
  {
    path: '/invite',
    name: 'invite',
    component: r('Invite')
  },
  {
    path: '/nominate',
    name: 'nominate',
    component: r('Nominate')
  },
  {
    path: '/profile',
    name: 'profile',
    component: r('Profile')
  },
  {
    path: '/signin',
    name: 'signin',
    component: r('SignIn')
  },
  {
    path: '/validators/:validator',
    name: 'validator',
    component: r('Validator')
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: r('Welcome')
  },
  {
    path: '*',
    redirect: '/'
  }
]
