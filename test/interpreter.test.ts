import { interpret, Interpreter, SimulatedClock } from '../src/interpreter';
import { assert } from 'chai';
import { machine as idMachine } from './fixtures/id';
import { Machine, actions, assign, send, sendParent } from '../src';
import { State } from '../src/State';
import { log, actionTypes } from '../src/actions';

const lightMachine = Machine({
  id: 'light',
  initial: 'green',
  states: {
    green: {
      onEntry: [actions.send('TIMER', { delay: 10 })],
      on: {
        TIMER: 'yellow',
        KEEP_GOING: {
          target: 'green',
          actions: [actions.cancel('TIMER')],
          internal: true
        }
      }
    },
    yellow: {
      onEntry: [actions.send('TIMER', { delay: 10 })],
      on: {
        TIMER: 'red'
      }
    },
    red: {
      after: {
        10: 'green'
      }
    }
  }
});

describe('interpreter', () => {
  it('creates an interpreter', () => {
    const service = interpret(idMachine);

    assert.instanceOf(service, Interpreter);
  });

  it('immediately notifies the listener with the initial state and event', done => {
    const service = interpret(idMachine).onTransition((initialState, event) => {
      assert.instanceOf(initialState, State);
      assert.deepEqual(initialState.value, idMachine.initialState.value);
      assert.deepEqual(event.type, actionTypes.init);
      done();
    });

    service.start();
  });

  it('.initialState returns the initial state', () => {
    const service = interpret(idMachine);

    assert.deepEqual(service.initialState, idMachine.initialState);
  });

  describe('id', () => {
    it('uses the ID specified in the options', () => {
      const service = interpret(lightMachine, { id: 'custom-id' });

      assert.equal(service.id, 'custom-id');
    });

    it('uses the machine ID if not specified', () => {
      const service = interpret(lightMachine);

      assert.equal(service.id, lightMachine.id);
    });
  });

  describe('.nextState() method', () => {
    it('returns the next state for the given event without changing the interpreter state', () => {
      const service = interpret(lightMachine, {clock: new SimulatedClock()}).start();

      const nextState = service.nextState('TIMER');
      assert.equal(nextState.value, 'yellow');
      assert.equal(service.state.value, 'green');
    });
  });

  describe('send with delay', () => {
    it('can send an event after a delay', () => {
      const currentStates: Array<State<any>> = [];
      const listener = state => {
        currentStates.push(state);

        if (currentStates.length === 4) {
          assert.deepEqual(currentStates.map(s => s.value), [
            'green',
            'yellow',
            'red',
            'green'
          ]);
        }
      };

      const service = interpret(lightMachine, {
        clock: new SimulatedClock()
      }).onTransition(listener);
      const clock = service.clock as SimulatedClock;
      service.start();

      clock.increment(5);
      assert.equal(
        currentStates[0]!.value,
        'green',
        'State should still be green before delayed send'
      );

      clock.increment(5);
      assert.deepEqual(currentStates.map(s => s.value), ['green', 'yellow']);

      clock.increment(5);
      assert.deepEqual(currentStates.map(s => s.value), ['green', 'yellow']);

      clock.increment(5);
      assert.deepEqual(currentStates.map(s => s.value), [
        'green',
        'yellow',
        'red'
      ]);

      clock.increment(5);
      assert.deepEqual(currentStates.map(s => s.value), [
        'green',
        'yellow',
        'red'
      ]);

      clock.increment(5);
      assert.deepEqual(currentStates.map(s => s.value), [
        'green',
        'yellow',
        'red',
        'green'
      ]);
    });

    it('can send an event after a delay (expression)', () => {
      interface DelayExprMachineCtx {
        initialDelay: number;
      }

      const delayExprMachine = Machine<DelayExprMachineCtx>({
        id: 'delayExpr',
        context: {
          initialDelay: 100
        },
        initial: 'idle',
        states: {
          idle: {
            on: {
              ACTIVATE: 'pending'
            }
          },
          pending: {
            onEntry: send('FINISH', {
              delay: (ctx, e) => ctx.initialDelay + ('wait' in e ? e.wait : 0)
            }),
            on: {
              FINISH: 'finished'
            }
          },
          finished: { type: 'final' }
        }
      });

      let stopped = false;

      const clock = new SimulatedClock();

      const delayExprService = interpret(delayExprMachine, {
        clock
      })
        .onDone(() => {
          stopped = true;
        })
        .start();

      delayExprService.send({
        type: 'ACTIVATE',
        wait: 50
      });

      clock.increment(101);

      assert.isFalse(stopped);

      clock.increment(50);

      assert.isTrue(stopped);
    });
  });

  describe('activities', () => {
    let activityState = 'off';

    const activityMachine = Machine(
      {
        id: 'activity',
        initial: 'on',
        states: {
          on: {
            activities: 'myActivity',
            on: {
              TURN_OFF: 'off'
            }
          },
          off: {}
        }
      },
      {
        activities: {
          myActivity: () => {
            activityState = 'on';
            return () => (activityState = 'off');
          }
        }
      }
    );

    it('should start activities', () => {
      const service = interpret(activityMachine);

      service.start();

      assert.equal(activityState, 'on');
    });

    it('should stop activities', () => {
      const service = interpret(activityMachine);

      service.start();

      assert.equal(activityState, 'on');

      service.send('TURN_OFF');

      assert.equal(activityState, 'off');
    });

    it('should stop activities upon stopping the service', () => {
      let stopActivityState: string;

      const stopActivityMachine = Machine(
        {
          id: 'stopActivity',
          initial: 'on',
          states: {
            on: {
              activities: 'myActivity',
              on: {
                TURN_OFF: 'off'
              }
            },
            off: {}
          }
        },
        {
          activities: {
            myActivity: () => {
              stopActivityState = 'on';
              return () => (stopActivityState = 'off');
            }
          }
        }
      );

      const stopActivityService = interpret(stopActivityMachine).start();

      assert.equal(stopActivityState!, 'on');

      stopActivityService.stop();

      assert.equal(stopActivityState!, 'off', 'activity should be disposed');
    });
  });

  it('can cancel a delayed event', () => {
    let currentState: State<any>;
    const listener = state => (currentState = state);

    const service = interpret(lightMachine, {
      clock: new SimulatedClock()
    }).onTransition(listener);
    const clock = service.clock as SimulatedClock;
    service.start();

    clock.increment(5);
    service.send('KEEP_GOING');

    assert.deepEqual(currentState!.value, 'green');
    clock.increment(10);
    assert.deepEqual(
      currentState!.value,
      'green',
      'should still be green due to canceled event'
    );
  });

  it('should throw an error if an event is sent to an uninitialized interpreter', () => {
    const service = interpret(lightMachine, {clock: new SimulatedClock()});

    assert.throws(() => service.send('SOME_EVENT'));

    service.start();

    assert.doesNotThrow(() => service.send('SOME_EVENT'));
  });

  it('should throw an error if initial state sent to interpreter is invalid', () => {
    const invalidMachine = {
      id: 'fetchMachine',
      initial: 'create',
      states: {
        edit: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                FETCH: 'pending'
              }
            }
          }
        }
      }
    };

    const service = interpret(Machine(invalidMachine));
    assert.throws(
      () => service.start(),
      `Initial state 'create' not found on 'fetchMachine'`
    );
  });

  it('should not update when stopped', () => {
    let state = lightMachine.initialState;
    const service = interpret(lightMachine, {clock: new SimulatedClock()}).onTransition(s => (state = s));

    service.start();
    service.send('TIMER'); // yellow
    assert.deepEqual(state.value, 'yellow');

    service.stop();
    try {
      service.send('TIMER'); // red if interpreter is not stopped
    } catch (e) {
      assert.deepEqual(state.value, 'yellow');
    }
  });

  it('should be able to log (log action)', () => {
    const logs: any[] = [];

    const logMachine = Machine({
      id: 'log',
      initial: 'x',
      context: { count: 0 },
      states: {
        x: {
          on: {
            LOG: {
              actions: [
                assign({ count: ctx => ctx.count + 1 }),
                log(ctx => ctx)
              ]
            }
          }
        }
      }
    });

    const service = interpret(logMachine, {
      logger: msg => logs.push(msg)
    }).start();

    service.send('LOG');
    service.send('LOG');

    assert.lengthOf(logs, 2);
    assert.deepEqual(logs, [{ count: 1 }, { count: 2 }]);
  });

  describe('send() event expressions', () => {
    interface Ctx {
      password: string;
    }
    const machine = Machine<Ctx>({
      id: 'sendexpr',
      initial: 'start',
      context: {
        password: 'foo'
      },
      states: {
        start: {
          onEntry: send(ctx => ({ type: 'NEXT', password: ctx.password })),
          on: {
            NEXT: {
              target: 'finish',
              cond: (_, e) => e.password === 'foo'
            }
          }
        },
        finish: {
          type: 'final'
        }
      }
    });

    it('should resolve send event expressions', done => {
      interpret(machine)
        .onDone(() => done())
        .start();
    });
  });

  describe('sendParent() event expressions', () => {
    interface Ctx {
      password: string;
    }
    const childMachine = Machine<Ctx>({
      id: 'child',
      initial: 'start',
      context: {
        password: 'unknown'
      },
      states: {
        start: {
          onEntry: sendParent(ctx => ({ type: 'NEXT', password: ctx.password }))
        }
      }
    });

    const parentMachine = Machine<Ctx>({
      id: 'parent',
      initial: 'start',
      states: {
        start: {
          invoke: {
            src: childMachine,
            data: {
              password: 'foo'
            }
          },
          on: {
            NEXT: {
              target: 'finish',
              cond: (_, e) => e.password === 'foo'
            }
          }
        },
        finish: {
          type: 'final'
        }
      }
    });

    it('should resolve sendParent event expressions', done => {
      interpret(parentMachine)
        .onDone(() => done())
        .start();
    });
  });

  describe('execute', () => {
    it('should not execute actions if execute is false', done => {
      let effect = false;

      const machine = Machine({
        id: 'noExecute',
        initial: 'active',
        states: {
          active: {
            type: 'final',
            onEntry: () => {
              effect = true;
            }
          }
        }
      });

      interpret(machine, { execute: false })
        .onDone(() => {
          assert.isFalse(effect);
          done();
        })
        .start();
    });

    it('should not execute actions if execute is true (default)', done => {
      let effect = false;

      const machine = Machine({
        id: 'noExecute',
        initial: 'active',
        states: {
          active: {
            type: 'final',
            onEntry: () => {
              effect = true;
            }
          }
        }
      });

      interpret(machine, { execute: true })
        .onDone(() => {
          assert.isTrue(effect);
          done();
        })
        .start();
    });

    it('actions should be able to be executed manually with execute()', done => {
      let effect = false;

      const machine = Machine({
        id: 'noExecute',
        initial: 'active',
        context: {
          value: true
        },
        states: {
          active: {
            type: 'final',
            onEntry: ctx => {
              effect = ctx.value;
            }
          }
        }
      });

      const service = interpret(machine, { execute: false })
        .onTransition(state => {
          setTimeout(() => {
            service.execute(state);
            assert.isTrue(effect);
            done();
          }, 10);
        })
        .onDone(() => {
          assert.isFalse(effect);
        })
        .start();
    });
  });
});
