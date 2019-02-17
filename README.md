## secrets of the `act(...)` api

tl;dr: wrap your test interactions with `act(() => ...)`. Maybe a custom babel config. React will take care of the rest.

### effects

Let's start with a simple component. It's contrived and doesn't do much, but is useful for this discussion.

```jsx
function App() {
  let [ctr, setCtr] = useState(0);
  useEffect(() => {
    setCtr(1);
  }, []);
  return ctr;
}
```

So, it's an `App` with 2 hooks - a `useState` initialized with `0`, and a `useEffect` which runs only once, setting this state to `1`. We'll render it to a browser like so:

```jsx
ReactDOM.render(<App />, document.getElementById("app"));
```

You run it, and you see `1` on your screen. This makes sense to you - the effect ran immediately, updated the state, and that rendered to your screen.

So you write a test for this behaviour, in everyone's favourite testing framework, [jest](https://jestjs.io/):

```jsx
it("should render 1", () => {
  const el = document.createElement("div");
  ReactDOM.render(<App />, el);
  expect(el.innerHTML).toBe("1"); // this fails!
});
```

You run your tests, and oops 😣

![image](https://user-images.githubusercontent.com/18808/52912654-441c9b80-32ac-11e9-9112-50b9329feebb.png)


That doesn't seem right. You check the value of `el.innerHTML` and it says `0`. But how can that be? Does jest do something strange? Or are you just hallucinating? The docs for useEffect make this a bit clearer - "By using this Hook, you tell React that your component needs to do something **after render**". How did you never see `0` in the browser, if even for a single moment?

To understand this, let's talk a bit about how React works. Since the big fiber rewrite of yore, React doesn't just 'synchronously' render the whole UI everytime you poke at it. It divides its work into chunks (called, er, 'work' 🙄), and queues it up in a scheduler. It could then choose to execute this at one go, or slowly if the cpu is throttled by serious work (like handling gobs of css in js), or even _not at all_ if it detects that the user can't even see it (it might be offscreen, or hidden, or made of bitcoin). _React only guarantees to be consistent to the user_, and doesn't match the expectations of interactions written in code.

In the component above, there are a few pieces of 'work' that are apparent to us:

- the 'first' render where react outputs `0`,
- the bit where it runs the effect and sets state to `1`
- the bit where it rerenders and outputs `1`

<img width="638" alt="screenshot 2019-02-17 at 13 26 03" src="https://user-images.githubusercontent.com/18808/52913619-9e6f2980-32b7-11e9-9d60-314cba4abdb2.png">

We can now see the problem. We run our test at a point in time when react hasn't even finished updating the UI. You _could_ hack around this:

- by using `useLayoutEffect` instead of `useEffect`: while this would pass the test, we've changed product behaviour for no good reason, and likely to its detriment.
- by waiting for some time, like 100ms or so: this is pretty ick, and might not even work depending on your setup.

Neither of these solutions are satisfying; we can do much better. In 16.8.0, we introduced a new testing api `act(...)`. It guarantees 2 things for any code run inside its scope:

- any state updates will be executed
- any enqueued effects will be executed

Further, React will warn you when you try to "set state" _outside of the scope of an `act(...)` call_. (ie - when you call the 2nd return value from a `useState`/`useReducer` hook)

Let's rewrite our test with this new api:

```jsx
it("should render 1", () => {
  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("1"); // this passes!
});
```

Neat, the test now passes! In short, "act" is a way of putting 'boundaries' around those bits of your code that actually 'interact' with your React app - these could be user interactions, apis, custom event handlers and subscriptions firing; anything that looks like it 'changes' something in your ui. React will make sure your UI is updated as 'expected', so you can make assertions on it.

<img width="558" alt="screenshot 2019-02-17 at 13 26 12" src="https://user-images.githubusercontent.com/18808/52913620-9f07c000-32b7-11e9-9553-12d6d03c3441.png">


(You can even nest multiple calls to `act`, composing interactions across functions, but in most cases you wouldn't need more than 1-2 levels of nesting.)

### events 

Let's look at another example; this time, events:

```jsx
function App() {
  let [counter, setCounter] = useState(0);
  return <button onClick={() => setCounter(counter + 1)}>{counter}</button>;
}
```

Pretty simple, I think: A button that increments a counter. You render this to a browser like before.

![ticker](https://user-images.githubusercontent.com/18808/52912742-64992580-32ad-11e9-8e1b-70e24d6329ee.gif)

So far, so good. Let's write a test for it.

```jsx
it("should increment a counter", () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  // we attach the element to document.body to ensure events work
  ReactDOM.render(<App />, el);
  const button = el.childNodes[0];
  for (let i = 0; i < 3; i++) {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
  expect(button.innerHTML).toBe("3");
});
```

This 'works' as expected. The warning doesn't fire for setStates called by 'real' event handlers, and for all intents and purposes this code is actually fine.

But you get suspicious, and because Sunil told you so, you extend the test a bit -

```jsx
act(() => {
  for (let i = 0; i < 3; i++) {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});
expect(button.innerHTML).toBe(3); // this fails, it's actually "1"!
```

The test fails, and `button.innerHTML` claims to be "1"! Well shit, at first, this seems annoying. But `act` has uncovered a potential bug here - if the handlers are ever called close to each other, it's possible that the handler will use stale data and miss some increments. The 'fix' is simple - we rewrite with 'setState' call with the updater form ie - `setCounter(x => x + 1)`, and the test passes. This demonstrates the value `act` brings to grouping and executing interactions together, resulting in more 'correct' code. Yay, thanks `act`!

### timers

Let's keep going. How about stuff based on timers? Let's write a component that 'ticks' after one second.

```jsx
function App() {
  const [ctr, setCtr] = useState(0);
  useEffect(() => {
    setTimeout(() => setCtr(1), 1000);
  }, []);
  return ctr;
}
```

Let's write a test for this:

```jsx
it("should tick to a new value", () => {
  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("0");
  // ???
  expect(el.innerHTML).toBe("1");
});
```

What could we do here? Let's lean on jest's [timer mocks](https://jestjs.io/docs/en/timer-mocks). Attempt 2:

```jsx
it("should tick to a new value", () => {
  jest.useFakeTimers();
  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("0");
  jest.runAllTimers();
  expect(el.innerHTML).toBe("1");
});
```

![image](https://user-images.githubusercontent.com/18808/52912877-885d6b00-32af-11e9-9a0b-0ba4f9adc756.png)

Better! We were able to convert asynchronous time space to be synchronous and manageable. We also get the warning; when we ran `runAllTimers()`, the timeout in the component resolved, triggering the setState. Like the warning advises, we mark the boundaries of that action with `act`. Attempt 3 -

```jsx
it("should tick to a new value", () => {
  jest.useFakeTimers();
  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("0");
  act(() => {
    jest.runAllTimers();
  });
  expect(el.innerHTML).toBe("1");
});
```

Test passes, no warnings, huzzah! Good stuff.

### promises

Let's keep going. This time, let's use promises. Consider a component that fetches data with, er, `fetch` -

```jsx
function App() {
  let [data, setData] = useState(null);
  useEffect(() => {
    fetch("/some/url").then(setData);
  }, []);
  return data;
}
```

Let's write a test again. This time, we'll mock `fetch` so we have control over when and how it responds:

```jsx
it("should display fetched data", () => {
  let resolve;
  // a rather simple mock, you might use something more advanced for your needs
  global.fetch = function fetch() {
    return {
      then(fn) {
        resolve = fn;
      }
    };
  };

  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("");
  resolve(42);
  expect(el.innerHTML).toBe("42");
});
```

The test passes, but we get the warning again. Like before, we wrap the bit that 'resolves' the promise with `act(...)`

```jsx
// ...
expect(el.innerHTML).toBe("");
act(() => {
  resolve(42);
});
expect(el.innerHTML).toBe("42");
// ...
```

This time, the test passes, and the warning's disappeared. Brilliant.

### async / await 

Now, let's do hard mode with `async/await`. This presents a challenge because whenever you use `await <some promise>;`, the javascript scheduler runs whatever comes next after the next tick, and it's hard for us to get a hold of this execution block to wrap `act(...)` around. Revisiting the component from the previous example -

```jsx
function App() {
  let [data, setData] = useState(null);
  async function somethingAsync() {
    let response = await fetch("/some/url");
    setData(response);
  }
  useEffect(() => {
    somethingAsync();
  }, []);
  return data;
}
```

And run the same test on it -

```jsx
it("should display fetched data", () => {
  let resolve;
  // a rather simple mock, you might use something more advanced for your needs
  global.fetch = function fetch() {
    return {
      then(fn) {
        resolve = fn;
      }
    };
  };

  const el = document.createElement("div");
  act(() => {
    ReactDOM.render(<App />, el);
  });
  expect(el.innerHTML).toBe("");
  act(() => {
    resolve(42);
  });
  expect(el.innerHTML).toBe("42");
});
```

Hmm. We notice that the test fails; `el.innerHTML` is still blank, and the setState doesn't get called (rather, it gets called after the test finishes!)

What can we do here?

The solution for this is a bit involved:

- we polyfill `Promise` globally with an implementation that can resolve promises 'immediately', such as [promise](https://www.npmjs.com/package/promise)
- transpile your javascript with a custom babel setup like [the one in this repo](https://github.com/threepointone/react-act-examples/blob/master/.babelrc)
- use `jest.runAllTimers()`; this will also now flush the promise task queue

Rewriting the test:

```jsx
// ...
expect(el.innerHTML).toBe("");
act(() => {
  resolve(42);
  jest.runAllTimers(); // we just added this
});
expect(el.innerHTML).toBe("42");
// ...
```

The tests pass! This is pretty powerful, and scales well. It's a pretty close approximation of the setup used at facebook.com, if that helps. With this setup, you should be well on your way to writing accurate tests that model user and browser behaviour more closely. For more detail, in this same repo, you'll find the above tests in [act-examples.test.js](https://github.com/threepointone/react-act-examples/blob/master/act-examples.test.js), as well as the custom babel config I used in [.babelrc](https://github.com/threepointone/react-act-examples/blob/master/.babelrc) (I would have put these up on codesandbox, but they don't yet support jest's timer mocks.)

---

Now, some of this isn't ideal. We can't expect everyone to use timer mocks and/or a custom build setup just to test their code. So what can we do better?

# (Disclaimer - the rest of this is [work in progress](https://github.com/facebook/react/pull/14853))

What if `act(...)` had an asynchronous version? Let's say we could write tests like this:

```jsx
await act(async () => {
  // do stuff
});
// make assertions
```

This simplifies a lot of rough edges with testing asynchronous logic in components. You don't have to mess with fake timers or builds anymore, and can write tests more 'naturally'. As a bonus, it'll be compatible with concurrent mode! Let's rewrite that last test with this new api.

```jsx
it("can handle async/await", async () => {
  // ...
  expect(el.innerHTML).toBe("");
  await act(async () => {
    resolve(42);
    // or you could await a timeout, or a promise that resolves elsewhere, etc
  });
  expect(el.innerHTML).toBe("42");
});
```

Much nicer. While it's less restrictive than the synchronous version, it supports all its features, but in an async form. The api makes some effort to make sure you don't interleave these calls, maintaining a tree-like shape of interactions at all times.


---

Notes:

- if you're using `ReactTestRenderer`, you should use `ReactTestRenderer.act` instead.
- we can reduce some of the boilerplate associated with this by integrating `act` directly with testing libraries; [react-testing-library](https://github.com/kentcdodds/react-testing-library/) already wraps its helper functions by default with act, and I hope that enzyme, and others like it, will do the same.
