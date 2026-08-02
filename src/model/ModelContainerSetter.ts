import { Container } from 'inversify';

import ApiUtil from './api/ApiUtil';
import BroadcastAffiliation from './channel/BroadcastAffiliation';
import BroadcastAffiliationCollector from './channel/BroadcastAffiliationCollector';
import BroadcastRegion from './channel/BroadcastRegion';
import IBroadcastAffiliation from './channel/IBroadcastAffiliation';
import IBroadcastAffiliationCollector from './channel/IBroadcastAffiliationCollector';
import IBroadcastRegion from './channel/IBroadcastRegion';
import ChannelApiModel from './api/channel/ChannelApiModel';
import IChannelApiModel from './api/channel/IChannelApiModel';
import AppSettingApiModel from './api/config/AppSettingApiModel';
import IAppSettingApiModel from './api/config/IAppSettingApiModel';
import IConfigOverlayLoader from './config/IConfigOverlayLoader';
import ConfigOverlayLoader from './config/ConfigOverlayLoader';
import ILogLevelApplier from './log/ILogLevelApplier';
import LogLevelApplier from './log/LogLevelApplier';
import IAuthModel from './auth/IAuthModel';
import AuthModel from './auth/AuthModel';
import IOAuthModel from './auth/IOAuthModel';
import OAuthModel from './auth/OAuthModel';
import IUserDB from './db/IUserDB';
import UserDB from './db/UserDB';
import IUpdateApiModel from './api/update/IUpdateApiModel';
import UpdateApiModel from './api/update/UpdateApiModel';
import IUpdateManageModel from './update/IUpdateManageModel';
import UpdateManageModel from './update/UpdateManageModel';
import ConfigApiModel from './api/config/ConfigApiModel';
import IConfigApiModel from './api/config/IConfigApiModel';
import DashboardApiModel from './api/dashboard/DashboardApiModel';
import IDashboardApiModel from './api/dashboard/IDashboardApiModel';
import DropLogApiModel from './api/dropLog/DropLogApiModel';
import IDropLogApiModel from './api/dropLog/IDropLogApiModel';
import EncodeApiModel from './api/encode/EncodeApiModel';
import IEncodeApiModel from './api/encode/IEncodeApiModel';
import IApiUtil from './api/IApiUtil';
import IIPTVApiModel from './api/iptv/IIPTVApiModel';
import IPTVApiModel from './api/iptv/IPTVApiModel';
import IRecordedItemUtil from './api/IRecordedItemUtil';
import IRecordedApiModel from './api/recorded/IRecordedApiModel';
import RecordedApiModel from './api/recorded/RecordedApiModel';
import RecordedItemUtil from './api/RecordedItemUtil';
import IRecordedTagApiModel from './api/recordedTag/IRecordedTagApiModel';
import RecordedTagApiModel from './api/recordedTag/RecordedTagApiModel';
import ISavedSearchApiModel from './api/savedSearch/ISavedSearchApiModel';
import SavedSearchApiModel from './api/savedSearch/SavedSearchApiModel';
import IRecordingApiModel from './api/recording/IRecordingApiModel';
import RecordingApiModel from './api/recording/RecordingApiModel';
import IReserveApiModel from './api/reserve/IReserveApiModel';
import ReserveApiModel from './api/reserve/ReserveApiModel';
import IRuleApiModel from './api/rule/IRuleApiModel';
import RuleApiModel from './api/rule/RuleApiModel';
import ISeriesApiModel from './api/series/ISeriesApiModel';
import SeriesApiModel from './api/series/SeriesApiModel';
import IAnnictSyncApiModel from './api/series/IAnnictSyncApiModel';
import AnnictSyncApiModel from './api/series/AnnictSyncApiModel';
import ISeriesMappingApiModel from './api/series/ISeriesMappingApiModel';
import SeriesMappingApiModel from './api/series/SeriesMappingApiModel';
import ISeriesPendingApiModel from './api/series/ISeriesPendingApiModel';
import SeriesPendingApiModel from './api/series/SeriesPendingApiModel';
import ISeriesMaintenanceApiModel from './api/series/ISeriesMaintenanceApiModel';
import SeriesMaintenanceApiModel from './api/series/SeriesMaintenanceApiModel';
import ISeriesAliasApiModel from './api/series/ISeriesAliasApiModel';
import SeriesAliasApiModel from './api/series/SeriesAliasApiModel';
import IMissingEpisodeApiModel from './api/series/IMissingEpisodeApiModel';
import MissingEpisodeApiModel from './api/series/MissingEpisodeApiModel';
import ISyobocalTitleApiModel from './api/series/ISyobocalTitleApiModel';
import SyobocalTitleApiModel from './api/series/SyobocalTitleApiModel';
import IAnnictWorkApiModel from './api/series/IAnnictWorkApiModel';
import AnnictWorkApiModel from './api/series/AnnictWorkApiModel';
import ISeriesImageModel from './api/series/ISeriesImageModel';
import SeriesImageModel from './api/series/SeriesImageModel';
import ISeriesBackfillApiModel from './api/series/ISeriesBackfillApiModel';
import SeriesBackfillApiModel from './api/series/SeriesBackfillApiModel';
import IScheduleApiModel from './api/schedule/IScheduleApiModel';
import ScheduleApiModel from './api/schedule/ScheduleApiModel';
import IProgramSeriesApiModel from './api/schedule/IProgramSeriesApiModel';
import ProgramSeriesApiModel from './api/schedule/ProgramSeriesApiModel';
import ILogApiModel from './api/log/ILogApiModel';
import LogApiModel from './api/log/LogApiModel';
import IStatusApiModel from './api/status/IStatusApiModel';
import StatusApiModel from './api/status/StatusApiModel';
import IStorageApiModel from './api/storage/IStorageApiModel';
import StorageApiModel from './api/storage/StorageApiModel';
import IStreamApiModel from './api/stream/IStreamApiModel';
import StreamApiModel from './api/stream/StreamApiModel';
import IThumbnailApiModel from './api/thumbnail/IThumbnailApiModel';
import ThumbnailApiModel from './api/thumbnail/ThumbnailApiModel';
import IVideoApiModel from './api/video/IVideoApiModel';
import IWatchHistoryApiModel from './api/video/IWatchHistoryApiModel';
import WatchHistoryApiModel from './api/video/WatchHistoryApiModel';
import IVideoUtil from './api/video/IVideoUtil';
import VideoApiModel from './api/video/VideoApiModel';
import VideoUtil from './api/video/VideoUtil';
import Configuration from './Configuration';
import ConnectionCheckModel from './ConnectionCheckModel';
import AppSettingDB from './db/AppSettingDB';
import IAppSettingDB from './db/IAppSettingDB';
import AppSettingHistoryDB from './db/AppSettingHistoryDB';
import IAppSettingHistoryDB from './db/IAppSettingHistoryDB';
import NotificationQueueDB from './db/NotificationQueueDB';
import INotificationQueueDB from './db/INotificationQueueDB';
import ChannelAffiliationDB from './db/ChannelAffiliationDB';
import ChannelDB from './db/ChannelDB';
import DBOperator from './db/DBOperator';
import DropLogFileDB from './db/DropLogFileDB';
import IChannelAffiliationDB from './db/IChannelAffiliationDB';
import IChannelDB from './db/IChannelDB';
import IDBOperator from './db/IDBOperator';
import IDropLogFileDB from './db/IDropLogFileDB';
import IProgramDB from './db/IProgramDB';
import IMetadataProviderCacheDB from './db/IMetadataProviderCacheDB';
import MetadataProviderCacheDB from './db/MetadataProviderCacheDB';
import IRecordedDB from './db/IRecordedDB';
import IRecordedHistoryDB from './db/IRecordedHistoryDB';
import IRecordedTagDB from './db/IRecordedTagDB';
import ISavedSearchDB from './db/ISavedSearchDB';
import IReserveDB from './db/IReserveDB';
import IRuleDB from './db/IRuleDB';
import ISeriesDB from './db/ISeriesDB';
import SeriesDB from './db/SeriesDB';
import ISyobocalTitleDB from './db/ISyobocalTitleDB';
import SyobocalTitleDB from './db/SyobocalTitleDB';
import IAnnictWorkDB from './db/IAnnictWorkDB';
import IWikidataProgramDB from './db/IWikidataProgramDB';
import WikidataProgramDB from './db/WikidataProgramDB';
import AnnictWorkDB from './db/AnnictWorkDB';
import IThumbnailDB from './db/IThumbnailDB';
import IVideoFileDB from './db/IVideoFileDB';
import IVideoFileTsInfoDB from './db/IVideoFileTsInfoDB';
import IWatchHistoryDB from './db/IWatchHistoryDB';
import IAnnictWatchSyncDB from './db/IAnnictWatchSyncDB';
import AnnictWatchSyncDB from './db/AnnictWatchSyncDB';
import ProgramDB from './db/ProgramDB';
import IProgramSeriesDB from './db/IProgramSeriesDB';
import ProgramSeriesDB from './db/ProgramSeriesDB';
import RecordedDB from './db/RecordedDB';
import RecordedHistoryDB from './db/RecordedHistoryDB';
import RecordedTagDB from './db/RecordedTagDB';
import SavedSearchDB from './db/SavedSearchDB';
import ReserveDB from './db/ReserveDB';
import RuleDB from './db/RuleDB';
import ThumbnailDB from './db/ThumbnailDB';
import VideoFileDB from './db/VideoFileDB';
import VideoFileTsInfoDB from './db/VideoFileTsInfoDB';
import WatchHistoryDB from './db/WatchHistoryDB';
import EPGUpdateExecutorManageModel from './epgUpdater/EPGUpdateExecutorManageModel';
import EPGUpdateManageModel from './epgUpdater/EPGUpdateManageModel';
import EPGUpdater from './epgUpdater/EPGUpdater';
import IEPGUpdateExecutorManageModel from './epgUpdater/IEPGUpdateExecutorManageModel';
import IEPGUpdateManageModel from './epgUpdater/IEPGUpdateManageModel';
import IEPGUpdater from './epgUpdater/IEPGUpdater';
import AppSettingChangeEvent from './event/AppSettingChangeEvent';
import IAppSettingChangeEvent from './event/IAppSettingChangeEvent';
import EncodeEvent from './event/EncodeEvent';
import EPGUpdateEvent from './event/EPGUpdateEvent';
import EventSetter from './event/EventSetter';
import IEncodeEvent from './event/IEncodeEvent';
import IEPGUpdateEvent from './event/IEPGUpdateEvent';
import IEventSetter from './event/IEventSetter';
import IOperatorEncodeEvent from './event/IOperatorEncodeEvent';
import IRecordedEvent from './event/IRecordedEvent';
import IRecordedTagEvent from './event/IRecordedTagEvent';
import IRecordingEvent from './event/IRecordingEvent';
import IReserveEvent from './event/IReserveEvent';
import IRuleEvent from './event/IRuleEvent';
import IThumbnailEvent from './event/IThumbnailEvent';
import OperatorEncodeEvent from './event/OperatorEncodeEvent';
import RecordedEvent from './event/RecordedEvent';
import RecordedTagEvent from './event/RecordedTagEvent';
import RecordingEvent from './event/RecordingEvent';
import ReserveEvent from './event/ReserveEvent';
import RuleEvent from './event/RuleEvent';
import ThumbnailEvent from './event/ThumbnailEvent';
import ExecutionManagementModel from './ExecutionManagementModel';
import IConfiguration from './IConfiguration';
import IConnectionCheckModel from './IConnectionCheckModel';
import IExecutionManagementModel from './IExecutionManagementModel';
import ILoggerModel from './ILoggerModel';
import IMirakurunClientModel from './IMirakurunClientModel';
import IIPCClient from './ipc/IIPCClient';
import IIPCServer from './ipc/IIPCServer';
import IPCClient from './ipc/IPCClient';
import IPCServer from './ipc/IPCServer';
import { IPromiseQueue } from './IPromiseQueue';
import IPromiseRetry from './IPromiseRetry';
import LoggerModel from './LoggerModel';
import MirakurunClientModel from './MirakurunClientModel';
import IMetadataProviderRegistry from './metadata/IMetadataProviderRegistry';
import MetadataProviderRegistry from './metadata/MetadataProviderRegistry';
import IMetadataService from './metadata/IMetadataService';
import MetadataService from './metadata/MetadataService';
import IProviderHttpClient from './metadata/IProviderHttpClient';
import ProviderHttpClient from './metadata/ProviderHttpClient';
import IMetadataEndpointResolver from './metadata/IMetadataEndpointResolver';
import MetadataEndpointResolver from './metadata/MetadataEndpointResolver';
import ISharedDataFetcher from './metadata/ISharedDataFetcher';
import SharedDataFetcher from './metadata/SharedDataFetcher';
import ISyobocalProvider from './metadata/syobocal/ISyobocalProvider';
import SyobocalProvider from './metadata/syobocal/SyobocalProvider';
import ISyobocalChannelMap from './metadata/syobocal/ISyobocalChannelMap';
import SyobocalChannelMap from './metadata/syobocal/SyobocalChannelMap';
import ISyobocalTitleDictionary from './metadata/syobocal/ISyobocalTitleDictionary';
import SyobocalTitleDictionary from './metadata/syobocal/SyobocalTitleDictionary';
import ISyobocalProgramLookup from './metadata/syobocal/ISyobocalProgramLookup';
import SyobocalProgramLookup from './metadata/syobocal/SyobocalProgramLookup';
import IAnnictWorkDictionary from './metadata/annict/IAnnictWorkDictionary';
import IWikidataProgramDictionary from './metadata/wikidata/IWikidataProgramDictionary';
import WikidataProgramDictionary from './metadata/wikidata/WikidataProgramDictionary';
import AnnictWorkDictionary from './metadata/annict/AnnictWorkDictionary';
import IWorkDictionary from './series/IWorkDictionary';
import WorkDictionary from './series/WorkDictionary';
import ISeriesMetadataFiller from './series/ISeriesMetadataFiller';
import SeriesMetadataFiller from './series/SeriesMetadataFiller';
import ILlmTitleExtractor from './series/ILlmTitleExtractor';
import LlmTitleExtractor from './series/LlmTitleExtractor';
import IAnnictProvider from './metadata/annict/IAnnictProvider';
import AnnictProvider from './metadata/annict/AnnictProvider';
import IAnnictSyncQueueModel from './metadata/annict/IAnnictSyncQueueModel';
import AnnictSyncQueueModel from './metadata/annict/AnnictSyncQueueModel';
import INotificationDispatcher from './notification/INotificationDispatcher';
import NotificationDispatcher from './notification/NotificationDispatcher';
import ExternalCommandManageModel from './operator/externalCommand/ExternalCommandManageModel';
import IExternalCommandManageModel from './operator/externalCommand/IExternalCommandManageModel';
import IReserveOptionChecker from './operator/IReserveOptionChecker';
import IImportJobManageModel from './operator/recorded/IImportJobManageModel';
import ImportJobManageModel from './operator/recorded/ImportJobManageModel';
import ISeriesBackfillManageModel from './operator/series/ISeriesBackfillManageModel';
import SeriesBackfillManageModel from './operator/series/SeriesBackfillManageModel';
import ISeriesStartupPipeline from './operator/series/ISeriesStartupPipeline';
import SeriesStartupPipeline from './operator/series/SeriesStartupPipeline';
import IImportWatchManageModel from './operator/recorded/IImportWatchManageModel';
import ImportWatchManageModel from './operator/recorded/ImportWatchManageModel';
import IRecordedManageModel from './operator/recorded/IRecordedManageModel';
import RecordedManageModel from './operator/recorded/RecordedManageModel';
import IRecordedTagManadeModel from './operator/recordedTag/IRecordedTagManadeModel';
import RecordedTagManadeModel from './operator/recordedTag/RecordedTagManadeModel';
import DropCheckerModel from './operator/recording/DropCheckerModel';
import IDropCheckerModel from './operator/recording/IDropCheckerModel';
import IVideoAnalyzeJobModel from './video/IVideoAnalyzeJobModel';
import VideoAnalyzeJobModel from './video/VideoAnalyzeJobModel';
import IVideoFileAnalyzeModel from './video/IVideoFileAnalyzeModel';
import VideoFileAnalyzeModel from './video/VideoFileAnalyzeModel';
import ITsInfoAnalyzer from './recorded/ts/ITsInfoAnalyzer';
import TsInfoAnalyzer from './recorded/ts/TsInfoAnalyzer';
import IRecorderModel, { RecorderModelProvider } from './operator/recording/IRecorderModel';
import IRecordingManageModel from './operator/recording/IRecordingManageModel';
import IRecordingStreamCreator from './operator/recording/IRecordingStreamCreator';
import IRecordingUtilModel from './operator/recording/IRecordingUtilModel';
import RecorderModel from './operator/recording/RecorderModel';
import RecordingManageModel from './operator/recording/RecordingManageModel';
import RecordingStreamCreator from './operator/recording/RecordingStreamCreator';
import RecordingUtilModel from './operator/recording/RecordingUtilModel';
import IReservationManageModel from './operator/reservation/IReservationManageModel';
import ReservationManageModel from './operator/reservation/ReservationManageModel';
import ReserveOptionChecker from './operator/ReserveOptionChecker';
import IRuleManageModel from './operator/rule/IRuleManageModel';
import RuleManageModel from './operator/rule/RuleManageModel';
import ISecretCrypto from './security/ISecretCrypto';
import SecretCrypto from './security/SecretCrypto';
import ISeriesResolver from './series/ISeriesResolver';
import SeriesResolver from './series/SeriesResolver';
import IStorageManageModel from './operator/storage/IStorageManageModel';
import StorageManageModel from './operator/storage/StorageManageModel';
import IThumbnailManageModel from './operator/thumbnail/IThumbnailManageModel';
import ThumbnailManageModel from './operator/thumbnail/ThumbnailManageModel';
import PromiseQueue from './PromiseQueue';
import PromiseRetry from './PromiseRetry';
import EncodeFileManageModel from './service/encode/EncodeFileManageModel';
import EncodeFinishModel from './service/encode/EncodeFinishModel';
import EncodeManageModel from './service/encode/EncodeManageModel';
import EncodeProcessManageModel from './service/encode/EncodeProcessManageModel';
import EncodeQueueStoreModel from './service/encode/EncodeQueueStoreModel';
import EncoderModel from './service/encode/EncoderModel';
import IEncodeFileManageModel from './service/encode/IEncodeFileManageModel';
import IEncodeFinishModel from './service/encode/IEncodeFinishModel';
import IEncodeManageModel from './service/encode/IEncodeManageModel';
import IEncodeProcessManageModel from './service/encode/IEncodeProcessManageModel';
import IEncodeQueueStoreModel from './service/encode/IEncodeQueueStoreModel';
import { EncoderModelProvider, IEncoderModel } from './service/encode/IEncoderModel';
import DataBroadcastingManageModel from './service/dataBroadcasting/DataBroadcastingManageModel';
import DataBroadcastingWebSocketServer from './service/dataBroadcasting/DataBroadcastingWebSocketServer';
import IDataBroadcastingManageModel from './service/dataBroadcasting/IDataBroadcastingManageModel';
import IDataBroadcastingWebSocketServer from './service/dataBroadcasting/IDataBroadcastingWebSocketServer';
import IServiceServer from './service/IServiceServer';
import ServiceServer from './service/ServiceServer';
import ISocketIOManageModel from './service/socketio/ISocketIOManageModel';
import SocketIOManageModel from './service/socketio/SocketIOManageModel';
import ILiveStreamBaseModel, {
    LiveHLSStreamModelProvider,
    LiveStreamModelProvider,
} from './service/stream/base/ILiveStreamBaseModel';
import IRecordedStreamBaseModel, {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from './service/stream/base/IRecordedStreamBaseModel';
import LiveHLSStreamModel from './service/stream/LiveHLSStreamModel';
import LiveStreamModel from './service/stream/LiveStreamModel';
import IStreamManageModel from './service/stream/manager/IStreamManageModel';
import StreamManageModel from './service/stream/manager/StreamManageModel';
import RecordedHLSStreamModel from './service/stream/RecordedHLSStreamModel';
import RecordedStreamModel from './service/stream/RecordedStreamModel';
import HLSFileDeleterModel from './service/stream/util/HLSFileDeleterModel';
import IHLSFileDeleterModel from './service/stream/util/IHLSFileDeleterModel';
import HLSMemoryStoreModel from './service/stream/util/HLSMemoryStoreModel';
import IHLSMemoryStoreModel from './service/stream/util/IHLSMemoryStoreModel';
import IStreamProfileManageModel from './stream/IStreamProfileManageModel';
import StreamProfileManageModel from './stream/StreamProfileManageModel';

/**
 * container に 各 Model を登録する
 */
export const set = (container: Container): void => {
    container.bind<ILoggerModel>('ILoggerModel').to(LoggerModel).inSingletonScope();

    container.bind<IConfiguration>('IConfiguration').to(Configuration).inSingletonScope();
    container.bind<ISecretCrypto>('ISecretCrypto').to(SecretCrypto).inSingletonScope();

    container.bind<INotificationDispatcher>('INotificationDispatcher').to(NotificationDispatcher).inSingletonScope();

    container.bind<IConnectionCheckModel>('IConnectionCheckModel').to(ConnectionCheckModel).inSingletonScope();

    container.bind<IPromiseQueue>('IPromiseQueue').to(PromiseQueue);

    container.bind<IPromiseRetry>('IPromiseRetry').to(PromiseRetry);

    container.bind<IExecutionManagementModel>('IExecutionManagementModel').to(ExecutionManagementModel);

    container.bind<IIPCClient>('IIPCClient').to(IPCClient).inSingletonScope();

    container.bind<IIPCServer>('IIPCServer').to(IPCServer).inSingletonScope();

    container.bind<IDBOperator>('IDBOperator').to(DBOperator).inSingletonScope();

    container.bind<IAppSettingDB>('IAppSettingDB').to(AppSettingDB).inSingletonScope();
    container.bind<IAppSettingHistoryDB>('IAppSettingHistoryDB').to(AppSettingHistoryDB).inSingletonScope();
    container.bind<INotificationQueueDB>('INotificationQueueDB').to(NotificationQueueDB).inSingletonScope();
    container.bind<IMetadataProviderCacheDB>('IMetadataProviderCacheDB').to(MetadataProviderCacheDB).inSingletonScope();
    container.bind<ISyobocalChannelMap>('ISyobocalChannelMap').to(SyobocalChannelMap).inSingletonScope();
    container.bind<ISyobocalProvider>('ISyobocalProvider').to(SyobocalProvider).inSingletonScope();
    container.bind<ISyobocalTitleDictionary>('ISyobocalTitleDictionary').to(SyobocalTitleDictionary).inSingletonScope();
    container.bind<ISyobocalProgramLookup>('ISyobocalProgramLookup').to(SyobocalProgramLookup).inSingletonScope();
    container.bind<IAnnictWorkDictionary>('IAnnictWorkDictionary').to(AnnictWorkDictionary).inSingletonScope();
    container
        .bind<IWikidataProgramDictionary>('IWikidataProgramDictionary')
        .to(WikidataProgramDictionary)
        .inSingletonScope();
    container.bind<IWorkDictionary>('IWorkDictionary').to(WorkDictionary).inSingletonScope();
    container.bind<ISeriesMetadataFiller>('ISeriesMetadataFiller').to(SeriesMetadataFiller).inSingletonScope();
    container.bind<ILlmTitleExtractor>('ILlmTitleExtractor').to(LlmTitleExtractor).inSingletonScope();
    container.bind<IAnnictProvider>('IAnnictProvider').to(AnnictProvider).inSingletonScope();
    container.bind<IAnnictSyncQueueModel>('IAnnictSyncQueueModel').to(AnnictSyncQueueModel).inSingletonScope();
    container
        .bind<IMetadataProviderRegistry>('IMetadataProviderRegistry')
        .to(MetadataProviderRegistry)
        .inSingletonScope();
    container.bind<IMetadataService>('IMetadataService').to(MetadataService).inSingletonScope();
    container.bind<IProviderHttpClient>('IProviderHttpClient').to(ProviderHttpClient).inSingletonScope();
    container
        .bind<IMetadataEndpointResolver>('IMetadataEndpointResolver')
        .to(MetadataEndpointResolver)
        .inSingletonScope();
    container.bind<ISharedDataFetcher>('ISharedDataFetcher').to(SharedDataFetcher).inSingletonScope();

    container.bind<IChannelDB>('IChannelDB').to(ChannelDB).inSingletonScope();

    container.bind<IProgramDB>('IProgramDB').to(ProgramDB).inSingletonScope();
    container.bind<IProgramSeriesDB>('IProgramSeriesDB').to(ProgramSeriesDB).inSingletonScope();

    container.bind<IRecordedDB>('IRecordedDB').to(RecordedDB).inSingletonScope();

    container.bind<IRecordedTagDB>('IRecordedTagDB').to(RecordedTagDB).inSingletonScope();

    container.bind<ISavedSearchDB>('ISavedSearchDB').to(SavedSearchDB).inSingletonScope();

    container.bind<IRecordedHistoryDB>('IRecordedHistoryDB').to(RecordedHistoryDB).inSingletonScope();

    container.bind<IReserveDB>('IReserveDB').to(ReserveDB).inSingletonScope();

    container.bind<IRuleDB>('IRuleDB').to(RuleDB).inRequestScope();

    container.bind<IThumbnailDB>('IThumbnailDB').to(ThumbnailDB).inSingletonScope();

    container.bind<IVideoFileDB>('IVideoFileDB').to(VideoFileDB).inSingletonScope();
    container.bind<IVideoFileTsInfoDB>('IVideoFileTsInfoDB').to(VideoFileTsInfoDB).inSingletonScope();
    container.bind<IChannelAffiliationDB>('IChannelAffiliationDB').to(ChannelAffiliationDB).inSingletonScope();
    container.bind<IWatchHistoryDB>('IWatchHistoryDB').to(WatchHistoryDB).inSingletonScope();
    container.bind<IAnnictWatchSyncDB>('IAnnictWatchSyncDB').to(AnnictWatchSyncDB).inSingletonScope();
    container.bind<ISeriesDB>('ISeriesDB').to(SeriesDB).inSingletonScope();
    container.bind<ISyobocalTitleDB>('ISyobocalTitleDB').to(SyobocalTitleDB).inSingletonScope();
    container.bind<IAnnictWorkDB>('IAnnictWorkDB').to(AnnictWorkDB).inSingletonScope();
    container.bind<IWikidataProgramDB>('IWikidataProgramDB').to(WikidataProgramDB).inSingletonScope();
    container.bind<ISeriesResolver>('ISeriesResolver').to(SeriesResolver).inSingletonScope();

    container.bind<IDropLogFileDB>('IDropLogFileDB').to(DropLogFileDB).inSingletonScope();

    container.bind<IRuleEvent>('IRuleEvent').to(RuleEvent).inSingletonScope();

    container.bind<IThumbnailEvent>('IThumbnailEvent').to(ThumbnailEvent).inSingletonScope();
    container.bind<IAppSettingChangeEvent>('IAppSettingChangeEvent').to(AppSettingChangeEvent).inSingletonScope();

    container.bind<IRecordedEvent>('IRecordedEvent').to(RecordedEvent).inSingletonScope();

    container.bind<IRecordingEvent>('IRecordingEvent').to(RecordingEvent).inSingletonScope();

    container.bind<IRecordedTagEvent>('IRecordedTagEvent').to(RecordedTagEvent).inSingletonScope();

    container.bind<IReserveEvent>('IReserveEvent').to(ReserveEvent).inSingletonScope();

    container.bind<IEPGUpdateEvent>('IEPGUpdateEvent').to(EPGUpdateEvent).inSingletonScope();

    container.bind<IOperatorEncodeEvent>('IOperatorEncodeEvent').to(OperatorEncodeEvent).inSingletonScope();

    container
        .bind<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel')
        .to(EPGUpdateExecutorManageModel)
        .inSingletonScope();

    container.bind<IReserveOptionChecker>('IReserveOptionChecker').to(ReserveOptionChecker).inSingletonScope();

    container.bind<IMirakurunClientModel>('IMirakurunClientModel').to(MirakurunClientModel).inSingletonScope();

    container.bind<IEPGUpdateManageModel>('IEPGUpdateManageModel').to(EPGUpdateManageModel).inSingletonScope();

    container.bind<IEPGUpdater>('IEPGUpdater').to(EPGUpdater).inSingletonScope();

    container.bind<IReservationManageModel>('IReservationManageModel').to(ReservationManageModel).inSingletonScope();

    container.bind<IRuleManageModel>('IRuleManageModel').to(RuleManageModel).inSingletonScope();

    container.bind<IRecordingStreamCreator>('IRecordingStreamCreator').to(RecordingStreamCreator).inSingletonScope();

    container.bind<IRecordingUtilModel>('IRecordingUtilModel').to(RecordingUtilModel).inSingletonScope();

    container.bind<IDropCheckerModel>('IDropCheckerModel').to(DropCheckerModel);
    container.bind<ITsInfoAnalyzer>('ITsInfoAnalyzer').to(TsInfoAnalyzer).inSingletonScope();
    container.bind<IVideoFileAnalyzeModel>('IVideoFileAnalyzeModel').to(VideoFileAnalyzeModel).inSingletonScope();
    // 一括解析ジョブは Service プロセスに常駐させ、画面を閉じても進捗を追えるようにする
    container.bind<IVideoAnalyzeJobModel>('IVideoAnalyzeJobModel').to(VideoAnalyzeJobModel).inSingletonScope();

    container.bind<IRecorderModel>('IRecorderModel').to(RecorderModel);

    container.bind<RecorderModelProvider>('RecorderModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecorderModel>(
                (resolve: (model: IRecorderModel) => void, reject: (err: Error) => void) => {
                    try {
                        const recorderModel = context.container.get<IRecorderModel>('IRecorderModel');
                        resolve(recorderModel);
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        };
    });

    container.bind<IRecordedManageModel>('IRecordedManageModel').to(RecordedManageModel).inSingletonScope();
    container.bind<IImportJobManageModel>('IImportJobManageModel').to(ImportJobManageModel).inSingletonScope();
    container
        .bind<ISeriesBackfillManageModel>('ISeriesBackfillManageModel')
        .to(SeriesBackfillManageModel)
        .inSingletonScope();

    container.bind<IUpdateManageModel>('IUpdateManageModel').to(UpdateManageModel).inSingletonScope();

    container.bind<ISeriesStartupPipeline>('ISeriesStartupPipeline').to(SeriesStartupPipeline).inSingletonScope();
    container.bind<IImportWatchManageModel>('IImportWatchManageModel').to(ImportWatchManageModel).inSingletonScope();

    container.bind<IRecordingManageModel>('IRecordingManageModel').to(RecordingManageModel).inSingletonScope();

    container.bind<IRecordedTagManadeModel>('IRecordedTagManadeModel').to(RecordedTagManadeModel).inSingletonScope();

    container.bind<IThumbnailManageModel>('IThumbnailManageModel').to(ThumbnailManageModel).inSingletonScope();

    container.bind<IStorageManageModel>('IStorageManageModel').to(StorageManageModel).inSingletonScope();

    container.bind<IEventSetter>('IEventSetter').to(EventSetter).inSingletonScope();

    container.bind<ISocketIOManageModel>('ISocketIOManageModel').to(SocketIOManageModel).inSingletonScope();

    container
        .bind<IDataBroadcastingManageModel>('IDataBroadcastingManageModel')
        .to(DataBroadcastingManageModel)
        .inSingletonScope();

    container
        .bind<IDataBroadcastingWebSocketServer>('IDataBroadcastingWebSocketServer')
        .to(DataBroadcastingWebSocketServer)
        .inSingletonScope();

    container
        .bind<IExternalCommandManageModel>('IExternalCommandManageModel')
        .to(ExternalCommandManageModel)
        .inSingletonScope();

    container.bind<IServiceServer>('IServiceServer').to(ServiceServer).inSingletonScope();

    container.bind<IApiUtil>('IApiUtil').to(ApiUtil).inSingletonScope();

    container.bind<IRecordedItemUtil>('IRecordedItemUtil').to(RecordedItemUtil).inSingletonScope();

    container.bind<IConfigApiModel>('IConfigApiModel').to(ConfigApiModel).inSingletonScope();
    container.bind<IAppSettingApiModel>('IAppSettingApiModel').to(AppSettingApiModel).inSingletonScope();
    container.bind<IUpdateApiModel>('IUpdateApiModel').to(UpdateApiModel).inSingletonScope();

    container.bind<ILogLevelApplier>('ILogLevelApplier').to(LogLevelApplier).inSingletonScope();
    container.bind<IConfigOverlayLoader>('IConfigOverlayLoader').to(ConfigOverlayLoader).inSingletonScope();

    container.bind<IUserDB>('IUserDB').to(UserDB).inSingletonScope();
    container.bind<IAuthModel>('IAuthModel').to(AuthModel).inSingletonScope();
    container.bind<IOAuthModel>('IOAuthModel').to(OAuthModel).inSingletonScope();

    container.bind<IDashboardApiModel>('IDashboardApiModel').to(DashboardApiModel).inSingletonScope();

    container.bind<IStatusApiModel>('IStatusApiModel').to(StatusApiModel).inSingletonScope();

    container.bind<ILogApiModel>('ILogApiModel').to(LogApiModel).inSingletonScope();

    container.bind<IBroadcastRegion>('IBroadcastRegion').to(BroadcastRegion).inSingletonScope();

    container.bind<IBroadcastAffiliation>('IBroadcastAffiliation').to(BroadcastAffiliation).inSingletonScope();

    container
        .bind<IBroadcastAffiliationCollector>('IBroadcastAffiliationCollector')
        .to(BroadcastAffiliationCollector)
        .inSingletonScope();

    container.bind<IChannelApiModel>('IChannelApiModel').to(ChannelApiModel).inSingletonScope();

    container.bind<IScheduleApiModel>('IScheduleApiModel').to(ScheduleApiModel).inSingletonScope();
    container.bind<IProgramSeriesApiModel>('IProgramSeriesApiModel').to(ProgramSeriesApiModel).inSingletonScope();

    container.bind<IReserveApiModel>('IReserveApiModel').to(ReserveApiModel).inSingletonScope();

    container.bind<IRecordedApiModel>('IRecordedApiModel').to(RecordedApiModel).inSingletonScope();
    container.bind<ISeriesApiModel>('ISeriesApiModel').to(SeriesApiModel).inSingletonScope();
    container.bind<IAnnictSyncApiModel>('IAnnictSyncApiModel').to(AnnictSyncApiModel).inSingletonScope();
    container.bind<ISeriesMappingApiModel>('ISeriesMappingApiModel').to(SeriesMappingApiModel).inSingletonScope();
    container.bind<ISeriesPendingApiModel>('ISeriesPendingApiModel').to(SeriesPendingApiModel).inSingletonScope();
    container
        .bind<ISeriesMaintenanceApiModel>('ISeriesMaintenanceApiModel')
        .to(SeriesMaintenanceApiModel)
        .inSingletonScope();
    container.bind<ISeriesAliasApiModel>('ISeriesAliasApiModel').to(SeriesAliasApiModel).inSingletonScope();
    container.bind<IMissingEpisodeApiModel>('IMissingEpisodeApiModel').to(MissingEpisodeApiModel).inSingletonScope();
    container.bind<ISyobocalTitleApiModel>('ISyobocalTitleApiModel').to(SyobocalTitleApiModel).inSingletonScope();
    container.bind<IAnnictWorkApiModel>('IAnnictWorkApiModel').to(AnnictWorkApiModel).inSingletonScope();
    container.bind<ISeriesImageModel>('ISeriesImageModel').to(SeriesImageModel).inSingletonScope();
    container.bind<ISeriesBackfillApiModel>('ISeriesBackfillApiModel').to(SeriesBackfillApiModel).inSingletonScope();

    container.bind<IRecordingApiModel>('IRecordingApiModel').to(RecordingApiModel).inSingletonScope();

    container.bind<IRecordedTagApiModel>('IRecordedTagApiModel').to(RecordedTagApiModel).inSingletonScope();

    container.bind<ISavedSearchApiModel>('ISavedSearchApiModel').to(SavedSearchApiModel).inSingletonScope();

    container.bind<IRuleApiModel>('IRuleApiModel').to(RuleApiModel).inSingletonScope();

    container.bind<IThumbnailApiModel>('IThumbnailApiModel').to(ThumbnailApiModel).inSingletonScope();

    container.bind<IDropLogApiModel>('IDropLogApiModel').to(DropLogApiModel).inSingletonScope();

    container.bind<IVideoUtil>('IVideoUtil').to(VideoUtil).inSingletonScope();

    container.bind<IVideoApiModel>('IVideoApiModel').to(VideoApiModel).inSingletonScope();
    container.bind<IWatchHistoryApiModel>('IWatchHistoryApiModel').to(WatchHistoryApiModel).inSingletonScope();

    container.bind<IEncodeApiModel>('IEncodeApiModel').to(EncodeApiModel).inSingletonScope();

    container.bind<IIPTVApiModel>('IIPTVApiModel').to(IPTVApiModel).inSingletonScope();

    container.bind<IEncodeEvent>('IEncodeEvent').to(EncodeEvent).inSingletonScope();

    container
        .bind<IEncodeProcessManageModel>('IEncodeProcessManageModel')
        .to(EncodeProcessManageModel)
        .inSingletonScope();

    // 視聴用ストリームはバックグラウンドの録画ファイルエンコードとは別の上限枠で管理する。
    // 同じ EncodeProcessManageModel の実装を使いつつ、別インスタンスにすることで
    // encodeProcessNum の消費状況にかかわらず streamProcessNum まで配信を開始できる。
    container
        .bind<IEncodeProcessManageModel>('IStreamProcessManageModel')
        .toDynamicValue(context => {
            const configure = context.container.get<IConfiguration>('IConfiguration');
            const manager = new EncodeProcessManageModel(
                context.container.get<ILoggerModel>('ILoggerModel'),
                configure,
            );
            manager.setMaxProcessNum(configure.getConfig().streamProcessNum);
            return manager;
        })
        .inSingletonScope();

    container.bind<IEncodeFileManageModel>('IEncodeFileManageModel').to(EncodeFileManageModel).inSingletonScope();

    container.bind<IEncoderModel>('IEncoderModel').to(EncoderModel);

    container.bind<EncoderModelProvider>('EncoderModelProvider').toProvider(context => {
        return () => {
            return new Promise<IEncoderModel>(
                (resolve: (model: IEncoderModel) => void, reject: (err: Error) => void) => {
                    try {
                        const encoderModel = context.container.get<IEncoderModel>('IEncoderModel');
                        resolve(encoderModel);
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        };
    });

    container.bind<IEncodeQueueStoreModel>('IEncodeQueueStoreModel').to(EncodeQueueStoreModel).inSingletonScope();

    container.bind<IEncodeManageModel>('IEncodeManageModel').to(EncodeManageModel).inSingletonScope();

    container.bind<IEncodeFinishModel>('IEncodeFinishModel').to(EncodeFinishModel).inSingletonScope();

    container.bind<ILiveStreamBaseModel>('LiveStreamModel').to(LiveStreamModel);

    container.bind<LiveStreamModelProvider>('LiveStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IHLSFileDeleterModel>('IHLSFileDeleterModel').to(HLSFileDeleterModel);

    // in-memory HLS セグメントストア
    // ストリーム生成側 (LiveStreamBaseModel) と配信側 (ServiceServer) で共有するため singleton で登録する
    container.bind<IHLSMemoryStoreModel>('IHLSMemoryStoreModel').to(HLSMemoryStoreModel).inSingletonScope();

    container.bind<ILiveStreamBaseModel>('LiveHLSStreamModel').to(LiveHLSStreamModel);

    container.bind<LiveHLSStreamModelProvider>('LiveHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveHLSStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedStreamModel').to(RecordedStreamModel);

    container.bind<RecordedStreamModelProvider>('RecordedStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedHLSStreamModel').to(RecordedHLSStreamModel);
    container.bind<RecordedHLSStreamModelProvider>('RecordedHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedHLSStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IStreamManageModel>('IStreamManageModel').to(StreamManageModel).inSingletonScope();

    container
        .bind<IStreamProfileManageModel>('IStreamProfileManageModel')
        .to(StreamProfileManageModel)
        .inSingletonScope();

    container.bind<IStreamApiModel>('IStreamApiModel').to(StreamApiModel).inSingletonScope();

    container.bind<IStorageApiModel>('IStorageApiModel').to(StorageApiModel).inSingletonScope();
};
