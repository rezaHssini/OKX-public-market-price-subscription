//Internal type definitions
interface IMarketDataParam {
  channel: "tickers";
  instId: string;
}
interface IMarketDataChannel {
  op: "subscribe" | "unsubscribe";
  args: IMarketDataParam[];
}
class CurrencyRepo {
  private pageSize = 10;
  private currencies: string[] = [];
  constructor(currencies?: string[], pageSize?: number) {
    if (currencies?.length) {
      //ensure theres no duplicated instruments in coming list
      const nonDuplicatedItems = Array.from(new Set(currencies));
      this.currencies.push(...nonDuplicatedItems);
    }

    if (pageSize && pageSize > 0) {
      this.pageSize = pageSize;
    }

    //ensure page size in less than data size
    if (this.pageSize > this.currencies.length) {
      this.pageSize = this.currencies.length - 1;
    }
  }

  public get(page: number, secondSideCurrency?: CurrencyEnum): string[] {
    const { start, end } = this.getPaginationDetails(page);
    if (!secondSideCurrency?.length) {
      return this.currencies.slice(start, end);
    } else {
      return this.currencies
        .filter(
          (e) => e.toUpperCase().indexOf(secondSideCurrency.toUpperCase()) != -1
        )
        .slice(start, end);
    }
  }

  public getPageSize(): number {
    return this.pageSize;
  }

  public getPageCount(): number {
    return Math.ceil(this.currencies.length / this.pageSize);
  }

  private getPaginationDetails(page: number): {
    start: number;
    end: number;
  } {
    if (page == 1) return { start: 0, end: this.pageSize };
    else
      return { start: (page - 1) * this.pageSize, end: page * this.pageSize };
  }
}
type VirtualCallBack = (evnt: { data: any }) => void;

//External type definitions
export enum CurrencyEnum {
  USDT = "USDT",
  ETH = "ETH",
  BTC = "BTC",
  EUR = "EUR",
  GBP = "GBP",
  TRY = "TRY",
}
export enum MarketTypeEnum {
  SPOT = "SPOT",
  MARGIN = "MARGIN",
  SWAP = "SWAP",
  FUTURES = "FUTURES",
  OPTION = "OPTION",
}
export interface IActiveChannel {
  socket: WebSocket;
  channel: IMarketDataChannel;
}
export interface ILiveData {
  instType: string;
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  sodUtc0: string;
  sodUtc8: string;
  volCcy24h: string;
  vol24h: string;
  ts: string;
}
export interface IChannleData {
  arg: { channel: "tickers"; instId: string };
  data: ILiveData[];
}
export type SubscriptionCallback = (data: ILiveData[]) => void;

import axios from "axios";
//Main Service class
export class MarketPriceService {
  protected okxRestUrl: string =
    "https://www.okx.com/api/v5/public/instruments?instType=";
  protected okxStreamURL: string = "wss://ws.okx.com:8443/ws/v5/public";
  protected activeChannel: IActiveChannel | null = null;
  private verbose: boolean = true;
  private pageSize = 10;
  private currenciesRepo: Map<MarketTypeEnum, CurrencyRepo> = new Map<
    MarketTypeEnum,
    CurrencyRepo
  >();

  constructor(
    verbose: boolean,
    streamUrl?: string,
    restUrl?: string,
    pageSize?: number
  ) {
    this.verbose = verbose;

    if (streamUrl?.length) {
      this.okxStreamURL = streamUrl;
    }

    if (restUrl?.length) {
      this.okxRestUrl = restUrl;
    }

    if (pageSize) {
      this.pageSize = pageSize;
    }
  }
  //Public methods
  public async get(
    page: number,
    type: MarketTypeEnum,
    callback: SubscriptionCallback,
    secondSideCurrency?: CurrencyEnum
  ): Promise<void> {
    if (!callback) {
      this.log("invalid callback passed to start new subscription.");
      throw new Error("invalid callback");
    }

    this.log("check and close current subscription...");
    await this.unsubscribeStreams();
    this.log("setting up new subscription arguments...");
    const currencies = await this.findCurrenciesByMarket(
      type,
      page,
      secondSideCurrency
    );
    this.activeChannel = this.getTickers(currencies);
    this.log("setting up new virtual callback to bind to subscription data...");
    const virtualCallBack = this.setupVirtualCallback(callback);
    this.activeChannel.socket.onmessage = virtualCallBack;
    this.log("new subscription started.");
  }

  public async dispose(): Promise<void> {
    this.log("disposing market price service...");
    await this.unsubscribeStreams();
    this.log("~Bye bye~");
  }

  public getPageSize(type: MarketTypeEnum): number {
    const repo = this.currenciesRepo.get(type);
    return repo?.getPageSize() || 0;
  }

  public getPageCount(type: MarketTypeEnum): number {
    const repo = this.currenciesRepo.get(type);
    return repo?.getPageCount() || 0;
  }

  //Private methods
  private setupVirtualCallback(
    callback: SubscriptionCallback
  ): VirtualCallBack {
    return (evnt: { data: any }) => {
      const parsed =
        typeof evnt.data === "string" ? JSON.parse(evnt.data) : evnt.data;
      const data = Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
      Boolean(data) ? callback(data) : null;
    };
  }

  private getTickers(currencyList: string[]): IActiveChannel {
    const channel: IMarketDataChannel = {
      op: "subscribe",
      args: currencyList.map((e) => {
        return { channel: "tickers", instId: e.toUpperCase() };
      }),
    };
    this.log("creating new subscription...");
    const socket = new WebSocket(this.okxStreamURL);
    socket.onopen = () => {
      socket.send(JSON.stringify(channel));
    };

    return { socket, channel };
  }

  private async unsubscribeStreams(): Promise<boolean> {
    if (this.activeChannel) {
      this.activeChannel.channel.op = "unsubscribe";
      try {
        this.log("closing subscription...");
        this.activeChannel.socket.send(
          JSON.stringify(this.activeChannel.channel)
        );
        this.activeChannel.socket.close();
        this.activeChannel.socket.onmessage = null;
        this.activeChannel = null;
        this.log("subscription closed.");
        return true;
      } catch (e) {
        this.log(
          `cannot close subscription due to error "${
            e instanceof Error ? e.message : e
          }", retrying...`
        );
        const _ctx = this;
        await sleep(300);
        return _ctx.unsubscribeStreams();
      }
    } else return true;
  }

  private log(message: string): void {
    if (!this.verbose) return;
    console.log(`Market Price Service: ${message}`);
  }

  private async findCurrenciesByMarket(
    type: MarketTypeEnum,
    page: number,
    secondSideCurrency?: CurrencyEnum
  ): Promise<string[]> {
    this.log(`looking for ${type} market currencies...`);
    let repo = this.currenciesRepo.get(type);
    if (!repo) {
      repo = await this.fetchCurrenciesByMarket(type);
      this.currenciesRepo.set(type, repo);
    }
    this.log("currencies are ready.");
    return repo.get(page, secondSideCurrency);
  }

  private async fetchCurrenciesByMarket(
    type: MarketTypeEnum
  ): Promise<CurrencyRepo> {
    try {
      this.log(`fetching currencies for market ${type}...`);
      const currencies = await axios.get(this.okxRestUrl + type.toUpperCase());
      this.log("currencies fetched.");
      return new CurrencyRepo(
        currencies.data?.data.map((e: { instId: string }) => e.instId),
        this.pageSize
      );
    } catch (error) {
      this.log(
        `cannot fetch ${type} market currencies due to error "${
          error instanceof Error ? error.message : error
        }"`
      );

      throw error;
    }
  }
}

//Utilities
const sleep = (interval: number = 1000) =>
  new Promise((resolve) => setTimeout(resolve, interval));
