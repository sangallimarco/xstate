import {
  StateValue,
  ActivityMap,
  EventObject,
  StateInterface,
  HistoryValue,
  ActionObject,
  EventType,
  StateValueMap,
  StateConfig,
  ActionTypes,
  OmniEventObject,
  BuiltInEvent
} from './types';
import { EMPTY_ACTIVITY_MAP } from './constants';
import { matchesState, keys } from './utils';
import { StateTree } from './StateTree';

export function stateValuesEqual(a: StateValue, b: StateValue): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }

  const aKeys = keys(a as StateValueMap);
  const bKeys = keys(b as StateValueMap);

  return (
    aKeys.length === bKeys.length &&
    aKeys.every(key => stateValuesEqual(a[key], b[key]))
  );
}

export class State<TContext, TEvent extends EventObject = EventObject>
  implements StateInterface<TContext> {
  public value: StateValue;
  public context: TContext;
  public historyValue?: HistoryValue | undefined;
  public history?: State<TContext>;
  public actions: Array<ActionObject<TContext, TEvent>> = [];
  public activities: ActivityMap = EMPTY_ACTIVITY_MAP;
  public meta: any = {};
  public events: TEvent[] = [];
  public event: OmniEventObject<TEvent>;
  /**
   * The state node tree representation of the state value.
   */
  public tree?: StateTree;
  /**
   * Creates a new State instance for the given `stateValue` and `context`.
   * @param stateValue
   * @param context
   */
  public static from<TC, TE extends EventObject = EventObject>(
    stateValue: State<TC, TE> | StateValue,
    context: TC
  ): State<TC, TE> {
    if (stateValue instanceof State) {
      if (stateValue.context !== context) {
        return new State<TC, TE>({
          value: stateValue.value,
          context,
          event: stateValue.event,
          historyValue: stateValue.historyValue,
          history: stateValue.history,
          actions: [],
          activities: stateValue.activities,
          meta: {},
          events: [],
          tree: stateValue.tree
        });
      }

      return stateValue;
    }

    const event = { type: ActionTypes.Init } as BuiltInEvent<TE>;

    return new State<TC, TE>({
      value: stateValue,
      context,
      event,
      historyValue: undefined,
      history: undefined,
      actions: [],
      activities: undefined,
      meta: undefined,
      events: []
    });
  }
  /**
   * Creates a new State instance for the given `config`.
   * @param config The state config
   */
  public static create<TC, TE extends EventObject = EventObject>(
    config: StateConfig<TC, TE>
  ): State<TC, TE> {
    return new State(config);
  }
  /**
   * Creates a new `State` instance for the given `stateValue` and `context` with no actions (side-effects).
   * @param stateValue
   * @param context
   */
  public static inert<TC, TE extends EventObject = EventObject>(
    stateValue: State<TC> | StateValue,
    context: TC
  ): State<TC, TE> {
    if (stateValue instanceof State) {
      if (!stateValue.actions.length) {
        return stateValue as State<TC, TE>;
      }
      const event = { type: ActionTypes.Init } as BuiltInEvent<TE>;

      return new State({
        value: stateValue.value,
        context,
        event,
        historyValue: stateValue.historyValue,
        history: stateValue.history,
        activities: stateValue.activities,
        tree: stateValue.tree
      });
    }

    return State.from<TC, TE>(stateValue, context);
  }

  /**
   * Returns a new `State` instance that is equal to this state no actions (side-effects).
   */
  public get inert(): State<TContext, TEvent> {
    return State.inert(this, this.context);
  }

  /**
   * Creates a new State instance.
   * @param value The state value
   * @param context The extended state
   * @param historyValue The tree representing historical values of the state nodes
   * @param history The previous state
   * @param actions An array of action objects to execute as side-effects
   * @param activities A mapping of activities and whether they are started (`true`) or stopped (`false`).
   * @param meta
   * @param events Internal event queue. Should be empty with run-to-completion semantics.
   * @param tree
   */
  constructor(config: StateConfig<TContext, TEvent>) {
    this.value = config.value;
    this.context = config.context;
    this.event = config.event;
    this.historyValue = config.historyValue;
    this.history = config.history;
    this.actions = config.actions || [];
    this.activities = config.activities || EMPTY_ACTIVITY_MAP;
    this.meta = config.meta || {};
    this.events = config.events || [];
    Object.defineProperty(this, 'tree', {
      value: config.tree,
      enumerable: false
    });
  }

  /**
   * The next events that will cause a transition from the current state.
   */
  public get nextEvents(): EventType[] {
    if (!this.tree) {
      return [];
    }

    return this.tree.nextEvents;
  }

  /**
   * Returns an array of all the string leaf state node paths.
   * @param stateValue
   * @param delimiter The character(s) that separate each subpath in the string state node path.
   */
  public toStrings(
    stateValue: StateValue = this.value,
    delimiter: string = '.'
  ): string[] {
    if (typeof stateValue === 'string') {
      return [stateValue];
    }
    const valueKeys = keys(stateValue);

    return valueKeys.concat(
      ...valueKeys.map(key =>
        this.toStrings(stateValue[key]).map(s => key + delimiter + s)
      )
    );
  }

  /**
   * Whether the current state value is a subset of the given parent state value.
   * @param parentStateValue
   */
  public matches(parentStateValue: StateValue): boolean {
    return matchesState(parentStateValue, this.value);
  }

  /**
   * Indicates whether the state has changed from the previous state. A state is considered "changed" if:
   *
   * - Its value is not equal to its previous value, or:
   * - It has any new actions (side-effects) to execute.
   *
   * An initial state (with no history) will return `undefined`.
   */
  public get changed(): boolean | undefined {
    if (!this.history) {
      return undefined;
    }

    return (
      !!this.actions.length ||
      typeof this.history.value !== typeof this.value ||
      !stateValuesEqual(this.value, this.history.value)
    );
  }
}
