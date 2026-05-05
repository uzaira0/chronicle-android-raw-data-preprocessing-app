# vulture whitelist — known false-positives
# Entries here tell vulture these names ARE used even if not detectable statically.

from chronicle_preprocessing_app.core.dataframe_provider import DataFrameProviderProtocol

# Protocol methods are "unused" to vulture but required by the interface
_ = DataFrameProviderProtocol.read_csv
_ = DataFrameProviderProtocol.to_csv
_ = DataFrameProviderProtocol.is_empty
_ = DataFrameProviderProtocol.get_column
_ = DataFrameProviderProtocol.set_column
_ = DataFrameProviderProtocol.filter
_ = DataFrameProviderProtocol.sort_by
_ = DataFrameProviderProtocol.reset_index
_ = DataFrameProviderProtocol.concat
_ = DataFrameProviderProtocol.name
