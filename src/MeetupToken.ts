// there is no type definition file for the meetup-api module so the following will error
import * as Web3 from 'web3';
import Meetup from './meetup';
import {Wallet, Contract,
    provider as Provider,
    providers as Providers} from 'ethers';

import Token from './transferableToken';
//import EthSigner from './ethSigner/ethSigner-hardcoded';
import EthSigner from './ethSigner/ethSigner-env';
import * as VError from 'verror';
import * as logger from 'config-logger';
import {MemberAddress} from './meetup';

export interface IMeetupToken {
    apiKey: string,
    urlname: string,
    contractAddress?: string,
    contractAddressBlock?: number,
    contractOwner: string,
    web3Url?: string,
    providerType?: string,
    providerParam1?: string,
    providerParam2?: string,
    providerParam3?: string,
    issueAmounts?: { [issueReason: string]: number}
}

export default class MeetupToken
{
    meetup: Meetup;
    token: Token;

    contractAddress: string;
    contractAddressBlock: number;
    contractOwner: string;

    // amount of tokens to be issued to a member for doing something
    issueAmounts: { [issueReason: string]: number} = {
        newMember: 10,
        attendEvent: 20,
        speakAtEvent: 30,
        hostEvent: 50,
        sponsorEvent: 100
    };

    constructor(options: IMeetupToken)
    {
        this.meetup = new Meetup(options.apiKey, options.urlname);

        this.contractAddress = options.contractAddress;
        this.contractAddressBlock = options.contractAddressBlock;
        this.contractOwner = options.contractOwner;

        if (options.issueAmounts) {
            this.issueAmounts = options.issueAmounts;
        }

        const web3Url = options.web3Url || "ws://localhost:8546";
        const providerType = options.providerType || "local";
        const providerParam1 = options.providerParam1 || "ws://localhost:8546";
        const providerParam2 = options.providerParam2 || false;
        const providerParam3 = options.providerParam3 || 1;

        try
        {
            const web3 = new Web3(web3Url);
            let provider: Provider;
            //const provider = new Providers.JsonRpcProvider(providerUrl, true, 100);  // ChainId 100 = 0x64
            if (providerType == 'infura') {
                provider = new Providers.InfuraProvider(providerParam1);
            }
            else if (providerType == 'jsonrpc') {
                provider = new Providers.JsonRpcProvider(providerParam1, providerParam2, providerParam3);
            }

            this.token = new Token(
                web3,
                provider,
                options.contractOwner,
                new EthSigner(),
                options.contractAddress);
        }
        catch (err)
        {
            const error = new VError(err, `Could not connect to web3 using ${web3Url} or provider type ${providerType} with params ${providerParam1}, ${providerParam2} and ${providerParam3}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async deployTokenContract(symbol: string, tokenName: string): Promise<string>
    {
        const description = `a new meetup token with symbol ${symbol} and token name ${tokenName}`;
        try
        {
            this.contractAddress = await this.token.deployContract(this.contractOwner, symbol, tokenName);

            logger.info(`Successfully deployed to address ${this.contractAddress} ${description}`);

            return this.contractAddress;
        }
        catch (err)
        {
            const error = new VError(err, `Could not deploy ${description}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async issueTokensToNewMembers(): Promise<MemberAddress[]>
    {
        const reason = 'newMember';

        try
        {
            // get the list of members who have already received tokens in the past
            const existingTokenHolders: string[] = await this.token.getIssueEvents(reason, this.contractAddressBlock);

            logger.debug(`${existingTokenHolders.length} members who have already received tokens in the past`);

            // get the list of members who have addresses in their Meetup intro
            const membersWithAddresses: MemberAddress[] = await this.meetup.extractMemberAddresses();

            logger.debug(`${membersWithAddresses.length} members who have addresses in their Meetup intro`);

            // get list of members with addresses who have not already been issued tokens
            const newMembersWithAddresses = MeetupToken.filterMembersWithAddressesNotInMembersFilter(membersWithAddresses, existingTokenHolders);

            logger.debug(`${newMembersWithAddresses.length} members who have not yet been issued tokens`);

            for (let newMemberWithAddresses of newMembersWithAddresses)
            {
                await this.token.issueTokens(
                    newMemberWithAddresses.address,
                    this.issueAmounts[reason],
                    newMemberWithAddresses.id.toString(),
                    reason);
            }

            logger.info(`Issued tokens to ${newMembersWithAddresses.length} new members`);

            return newMembersWithAddresses;
        }
        catch (err)
        {
            const error = new VError(err, `Failed to issue tokens to new meetup members`);
            logger.error(error.stack);
            throw error;
        }
    }

    async issueTokensToMembersAtEvent(eventId: number): Promise<MemberAddress[]>
    {
        const reason = 'attendEvent';

        try
        {
            // get the list of members who have already received tokens for attending an event
            const membersAlreadyIssuedTokensForReason: string[] = await this.token.getIssueEvents(reason, this.contractAddressBlock);

            logger.debug(`${membersAlreadyIssuedTokensForReason.length} members who have already been issued tokens for reason ${reason}, event id ${eventId}`);

            // get list of members who attended the Meetup event
            const membersAtEvent: string[] = await this.meetup.getMembersAtEvent(eventId);

            logger.debug(`${membersAtEvent.length} members attended the Meetup event with id ${eventId}`);

            // get members who have not already been issued tokens
            const membersToIssueTokens = membersAtEvent.filter(member => membersAlreadyIssuedTokensForReason.indexOf(member) == -1);

            return await this.issueTokensToMembers(membersToIssueTokens, this.issueAmounts.attendEvent, reason)
        }
        catch (err)
        {
            const error = new VError(err, `Failed to issue tokens to members of the ${this.meetup.urlname} Meetup who attended event with id ${eventId}`);
            logger.error(error.stack);
            throw error;
        }
    }

    async issueTokensToMembers(memberMeetupIds: string[], amount: number, reason: string): Promise<MemberAddress[]>
    {
        try
        {
            // get list of members who have addresses in their meetup intro
            const membersWithAddresses: MemberAddress[] = await this.meetup.extractMemberAddresses();

            logger.debug(`${membersWithAddresses.length} members who have addresses in their Meetup intro`);

            // get list of members with addresses who are to be issued tokens
            const membersWithAddressesToIssue = MeetupToken.filterMembersWithAddressesInMembersFilter(membersWithAddresses, memberMeetupIds);

            logger.debug(`${membersWithAddressesToIssue.length} of ${memberMeetupIds.length} members to be issued tokens have an address`);

            // for each member, issue a token
            for (let memberWithAddressesToIssue of membersWithAddressesToIssue)
            {
                await this.token.issueTokens(
                    memberWithAddressesToIssue.address,
                    amount,
                    memberWithAddressesToIssue.id.toString(),
                    reason);
            }

            logger.info(`Issued tokens to ${membersWithAddressesToIssue.length} new members`);

            return membersWithAddressesToIssue;
        }
        catch (err)
        {
            const error = new VError(err, `Failed to issue ${amount} tokens to members with ids: ${memberMeetupIds}`);
            logger.error(error.stack);
            throw error;
        }
    }

    static filterMembersWithAddressesInMembersFilter(membersWithAddresses: MemberAddress[], membersFilter: string[]): MemberAddress[]
    {
        const membersWithAddressesInFilter: MemberAddress[] = [];
        for (let memberWithAddress of membersWithAddresses)
        {
            for (let member of membersFilter)
            {
                if ( memberWithAddress.id.toString() === member )
                {
                    membersWithAddressesInFilter.push(memberWithAddress);
                    break;
                }
            }
        }

        return membersWithAddressesInFilter;
    }

    static filterMembersWithAddressesNotInMembersFilter(membersWithAddresses: MemberAddress[], membersFilter: string[]): MemberAddress[]
    {
        const membersWithAddressesInFilter: MemberAddress[] = [];
        for (let memberWithAddress of membersWithAddresses)
        {
            let found = false;
            for (let member of membersFilter)
            {
                if ( memberWithAddress.id.toString() === member )
                {
                    found = true;
                    break;
                }
            }

            if (!found) {
                membersWithAddressesInFilter.push(memberWithAddress);
            }
        }

        return membersWithAddressesInFilter;
    }
}
