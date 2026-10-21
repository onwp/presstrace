<?php
/**
 * The agent: decides whether to trace, wires the collectors and sends the payload at shutdown.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Agent', false ) ) {
	return;
}

/**
 * Request lifecycle orchestration.
 */
final class PressTrace_Agent {

	/**
	 * Seconds the agent stops sending after a failed send.
	 */
	const BACKOFF_SECONDS = 60;

	/**
	 * Singleton.
	 *
	 * @var PressTrace_Agent|null
	 */
	private static $instance = null;

	/**
	 * Main plugin file.
	 *
	 * @var string
	 */
	private $plugin_file;

	/**
	 * Loader mu-plugin file (empty when booted from the main plugin file).
	 *
	 * @var string
	 */
	private $loader_file;

	/**
	 * Effective settings.
	 *
	 * @var array
	 */
	private $settings = array();

	/**
	 * Resolver.
	 *
	 * @var PressTrace_Components|null
	 */
	private $resolver = null;

	/**
	 * Hook wrapper.
	 *
	 * @var PressTrace_Hooks|null
	 */
	private $hooks = null;

	/**
	 * HTTP capture.
	 *
	 * @var PressTrace_Http|null
	 */
	private $http = null;

	/**
	 * Error capture.
	 *
	 * @var PressTrace_Errors|null
	 */
	private $errors = null;

	/**
	 * DB capture mode.
	 *
	 * @var string
	 */
	private $db_mode = 'query_filter';

	/**
	 * Whether this trace was forced with ?presstrace_force=1 and still needs a capability check.
	 *
	 * @var bool
	 */
	private $forced = false;

	/**
	 * Whether the trace was abandoned (forced by a user without manage_options).
	 *
	 * @var bool
	 */
	private $aborted = false;

	/**
	 * The matched REST route pattern.
	 *
	 * @var string|null
	 */
	private $rest_route = null;

	/**
	 * Boots the agent once per request.
	 *
	 * @param string $plugin_file Main plugin file.
	 * @param string $loader_file Loader mu-plugin file, or an empty string.
	 * @return void
	 */
	public static function boot( $plugin_file, $loader_file ) {
		if ( null !== self::$instance ) {
			return;
		}
		self::$instance = new self( $plugin_file, $loader_file );
		self::$instance->maybe_start();
	}

	/**
	 * Returns true once the agent has booted in this request.
	 *
	 * @return bool
	 */
	public static function booted() {
		return null !== self::$instance;
	}

	/**
	 * Constructor.
	 *
	 * @param string $plugin_file Main plugin file.
	 * @param string $loader_file Loader file.
	 */
	private function __construct( $plugin_file, $loader_file ) {
		$this->plugin_file = $plugin_file;
		$this->loader_file = $loader_file;
	}

	/**
	 * Starts tracing when every condition holds, otherwise stays dormant.
	 *
	 * @return void
	 */
	private function maybe_start() {
		PressTrace_Clock::init();
		try {
			if ( $this->should_trace() ) {
				$this->start();
				return;
			}
		} catch ( Throwable $e ) {
			PressTrace_Trace::$active = false;
		}
		PressTrace_Db_Capture::stop( true );
	}

	/**
	 * Decides whether this request is traced. Cheap checks first.
	 *
	 * @return bool
	 */
	private function should_trace() {
		if ( defined( 'WP_INSTALLING' ) && WP_INSTALLING ) {
			return false;
		}

		$cli = self::is_cli();
		if ( $cli && ! ( defined( 'PRESSTRACE_TRACE_CLI' ) && PRESSTRACE_TRACE_CLI ) ) {
			return false;
		}

		$this->settings = PressTrace_Settings::get();
		if ( ! PressTrace_Settings::is_configured( $this->settings ) ) {
			return false;
		}

		if ( $this->is_own_request() ) {
			return false;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only flag, verified with a capability check at init.
		$forced = ! $cli && isset( $_GET['presstrace_force'] ) && '1' === $_GET['presstrace_force'];

		if ( ! $forced ) {
			if ( ! PressTrace_Settings::is_monitoring( $this->settings, time() ) ) {
				return false;
			}
			$random = mt_rand() / ( mt_getrandmax() + 1 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.rand_mt_rand -- sampling, not security.
			if ( ! PressTrace_Settings::is_sampled( (float) $this->settings['sample_rate'], $random ) ) {
				return false;
			}
		}

		/**
		 * Filters whether the current request is traced. Runs from the loader mu-plugin, so only
		 * mu-plugins loaded before it and wp-config.php code can hook in.
		 *
		 * @param bool  $trace   Whether to trace.
		 * @param array $context Keys: forced (bool), cli (bool), uri (string).
		 */
		$trace = (bool) apply_filters(
			'presstrace_should_trace',
			true,
			array(
				'forced' => $forced,
				'cli'    => $cli,
				'uri'    => isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '', // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- passed to filters as context only.
			)
		);

		$this->forced = $trace && $forced;
		return $trace;
	}

	/**
	 * Returns true for requests made by PressTrace itself and for the favicon.
	 *
	 * @return bool
	 */
	private function is_own_request() {
		// phpcs:disable WordPress.Security.NonceVerification -- routing decision only.
		if ( wp_doing_ajax() && isset( $_REQUEST['action'] ) && is_string( $_REQUEST['action'] ) && 0 === strpos( $_REQUEST['action'], 'presstrace_' ) ) {
			return true;
		}
		// phpcs:enable
		if ( isset( $_SERVER['REQUEST_URI'] ) ) {
			$path = (string) strtok( (string) $_SERVER['REQUEST_URI'], '?' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- compared only.
			if ( '/favicon.ico' === $path ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Installs all collectors.
	 *
	 * @return void
	 */
	private function start() {
		PressTrace_Trace::$active = true;
		$this->db_mode            = PressTrace_Db_Capture::claim();

		$this->resolver = PressTrace_Components::from_environment( dirname( $this->plugin_file ) );
		if ( '' !== $this->loader_file ) {
			$this->resolver->ignore( $this->loader_file, false );
		}

		$this->errors = new PressTrace_Errors( $this->resolver );
		$this->errors->install();

		$this->hooks = new PressTrace_Hooks( $this->resolver, $this->loader_file );
		$this->hooks->install();

		$this->http = new PressTrace_Http( $this->resolver );
		$this->http->install();

		add_filter( 'rest_dispatch_request', array( $this, 'on_rest_dispatch' ), PHP_INT_MAX, 3 );
		add_filter( 'rest_post_dispatch', array( $this, 'on_rest_post_dispatch' ), PHP_INT_MAX, 3 );

		if ( $this->forced ) {
			add_action( 'init', array( $this, 'verify_forced' ), PHP_INT_MIN );
		}

		// Callbacks that ended the request with exit (wp_send_json, wp_redirect plus exit) are closed before the
		// shutdown hook runs, so their time does not include shutdown callbacks.
		add_action( 'shutdown', array( 'PressTrace_Callback', 'close_all' ), PHP_INT_MIN );

		register_shutdown_function( array( $this, 'on_shutdown' ) );
	}

	/**
	 * Abandons a forced trace when the current user may not force traces.
	 *
	 * @return void
	 */
	public function verify_forced() {
		if ( current_user_can( 'manage_options' ) ) {
			return;
		}
		$this->aborted = true;
		$this->stop_collecting();
		PressTrace_Trace::reset();
	}

	/**
	 * Remembers the matched REST route pattern.
	 *
	 * @param mixed  $result  Dispatch result, returned unchanged.
	 * @param object $request Request.
	 * @param string $route   Route pattern.
	 * @return mixed
	 */
	public function on_rest_dispatch( $result, $request, $route ) {
		if ( null === $this->rest_route && is_string( $route ) ) {
			$this->rest_route = $route;
		}
		return $result;
	}

	/**
	 * Finds the route pattern for REST requests that never reached rest_dispatch_request, for example when the
	 * permission check failed (401, 403) or the arguments were invalid (400), the same way WordPress matches it.
	 *
	 * @param mixed  $result  Response, returned unchanged.
	 * @param object $server  REST server.
	 * @param object $request Request.
	 * @return mixed
	 */
	public function on_rest_post_dispatch( $result, $server, $request ) {
		if ( null !== $this->rest_route || ! is_object( $server ) || ! method_exists( $server, 'get_routes' ) || ! is_object( $request ) || ! method_exists( $request, 'get_route' ) ) {
			return $result;
		}
		$path   = (string) $request->get_route();
		$method = method_exists( $request, 'get_method' ) ? strtoupper( (string) $request->get_method() ) : '';
		foreach ( $server->get_routes() as $route => $handlers ) {
			if ( ! preg_match( '@^' . $route . '$@i', $path ) ) {
				continue;
			}
			foreach ( (array) $handlers as $handler ) {
				if ( '' === $method || ! empty( $handler['methods'][ $method ] ) ) {
					$this->rest_route = (string) $route;
					return $result;
				}
			}
		}
		return $result;
	}

	/**
	 * First shutdown pass: schedules the real work after every other shutdown function.
	 *
	 * @return void
	 */
	public function on_shutdown() {
		register_shutdown_function( array( $this, 'send' ) );
	}

	/**
	 * Builds the payload, finishes the response and sends it. Never throws.
	 *
	 * @return void
	 */
	public function send() {
		try {
			if ( $this->aborted || ! PressTrace_Trace::$active ) {
				return;
			}
			// A forced trace whose request ended before init never had its capability check: drop it.
			if ( $this->forced && ! did_action( 'init' ) ) {
				return;
			}

			$duration = PressTrace_Clock::now();
			PressTrace_Callback::close_all();
			$this->errors->capture_fatal();
			$this->stop_collecting();

			$status = http_response_code();
			$tx     = $this->transaction_fields( $duration, false === $status ? ( self::is_cli() ? 0 : 200 ) : (int) $status );

			$finished = self::finish_request();
			$payload  = $this->build_payload( $tx );

			/**
			 * Filters the payload before it is sent. Return a non-array to drop it.
			 *
			 * @param array $payload Payload (format v1).
			 */
			$payload = apply_filters( 'presstrace_payload', $payload );
			if ( ! is_array( $payload ) ) {
				return;
			}

			$json = PressTrace_Payload::encode( $payload );
			if ( false === $json ) {
				return;
			}

			$headers = array(
				'Authorization'      => 'Bearer ' . $this->settings['site_key'],
				'Content-Type'       => 'application/json',
				'X-PressTrace-Agent' => PRESSTRACE_VERSION,
			);
			$body    = $json;
			if ( function_exists( 'gzencode' ) ) {
				$gzip = gzencode( $json, 6 );
				if ( false !== $gzip ) {
					$body                        = $gzip;
					$headers['Content-Encoding'] = 'gzip';
				}
			}

			// After a failed send (app down or hanging) the agent skips sending for a minute, so an outage does not
			// keep every PHP worker busy for the whole timeout and exhaust the pool.
			$backoff = self::backoff_file( $this->settings['app_url'] );
			$failed  = '' !== $backoff ? @filemtime( $backoff ) : false; // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a missing file is the normal case.
			if ( false !== $failed && $failed > time() - self::BACKOFF_SECONDS ) {
				return;
			}

			$response = wp_remote_post(
				$this->settings['app_url'] . '/api/v1/ingest',
				array(
					'timeout'                 => $finished ? 2 : 0.5,
					'blocking'                => true,
					'redirection'             => 0,
					'headers'                 => $headers,
					'body'                    => $body,
					'user-agent'              => 'PressTrace/' . PRESSTRACE_VERSION,
					PressTrace_Http::INTERNAL => true,
				)
			);
			if ( is_wp_error( $response ) && '' !== $backoff ) {
				@touch( $backoff ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged,WordPress.WP.AlternativeFunctions.file_system_operations_touch -- best effort, never fails the request.
			}
		} catch ( Throwable $e ) {
			// Monitoring must never break the site. The payload is dropped.
			return;
		}
	}

	/**
	 * Path of the file whose modification time marks the last failed send, outside the database.
	 *
	 * @param string $app_url App URL.
	 * @return string Empty when no writable temp directory is known.
	 */
	private static function backoff_file( $app_url ) {
		$dir = function_exists( 'get_temp_dir' ) ? (string) get_temp_dir() : '';
		return '' === $dir ? '' : trailingslashit( $dir ) . 'presstrace-backoff-' . md5( (string) $app_url );
	}

	/**
	 * Stops all recording.
	 *
	 * @return void
	 */
	private function stop_collecting() {
		PressTrace_Trace::$active = false;
		PressTrace_Db_Capture::stop( false );
		if ( null !== $this->hooks ) {
			$this->hooks->uninstall();
		}
		if ( null !== $this->http ) {
			$this->http->uninstall();
		}
	}

	/**
	 * Builds the payload array.
	 *
	 * @param array $tx Transaction fields.
	 * @return array
	 */
	private function build_payload( array $tx ) {
		$capped = PressTrace_Trace::spans();
		$spans  = array();
		foreach ( $capped['spans'] as $span ) {
			if ( 'db' === $span['kind'] ) {
				$frames            = isset( $span['_frames'] ) ? $span['_frames'] : array();
				$fallback          = empty( $span['_context'] ) ? 'core' : $span['_context'];
				$span['component'] = $this->resolver->from_frames( $frames, $fallback );
				$span['stack']     = $span['duration'] >= PressTrace_Trace::SLOW_MS ? $this->resolver->stack( $frames ) : null;
			}
			$spans[] = $span;
		}

		$limit = function_exists( 'wp_convert_hr_to_bytes' ) ? wp_convert_hr_to_bytes( (string) ini_get( 'memory_limit' ) ) : -1;

		return PressTrace_Payload::build(
			PRESSTRACE_VERSION,
			array(
				'php'             => PHP_VERSION,
				'wp'              => isset( $GLOBALS['wp_version'] ) ? $GLOBALS['wp_version'] : '',
				'memory_limit_mb' => $limit > 0 ? (int) round( $limit / 1048576 ) : -1,
				'object_cache'    => function_exists( 'wp_using_ext_object_cache' ) && wp_using_ext_object_cache(),
				'db_capture'      => $this->db_mode,
			),
			$tx,
			$spans,
			PressTrace_Trace::components(),
			PressTrace_Trace::errors(),
			$capped['dropped']
		);
	}

	/**
	 * Collects the transaction fields.
	 *
	 * @param float $duration Duration in ms.
	 * @param int   $status   HTTP status.
	 * @return array
	 */
	private function transaction_fields( $duration, $status ) {
		$ctx  = $this->request_facts();
		$type = PressTrace_Namer::type( $ctx );

		/**
		 * Filters the transaction name.
		 *
		 * @param string $name Name such as "single-product" or "REST GET /wp/v2/posts/{id}".
		 * @param string $type Transaction type.
		 * @param array  $ctx  Request facts used for naming.
		 */
		$name = (string) apply_filters( 'presstrace_transaction_name', PressTrace_Namer::name( $ctx ), $type, $ctx );

		try {
			$id = bin2hex( random_bytes( 16 ) );
		} catch ( Exception $e ) {
			$id = md5( uniqid( (string) mt_rand(), true ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.rand_mt_rand -- fallback ID only.
		}

		$logged_in = false;
		if ( function_exists( 'is_user_logged_in' ) && did_action( 'init' ) ) {
			$logged_in = is_user_logged_in();
		}

		return array(
			'id'             => $id,
			'ts'             => (int) round( PressTrace_Clock::request_start() * 1000 ),
			'name'           => '' === $name ? 'unknown' : substr( $name, 0, 200 ),
			'type'           => $type,
			'method'         => $ctx['cli'] ? 'CLI' : PressTrace_Namer::method( $ctx['method'] ),
			'url'            => $this->request_url(),
			'status'         => $status,
			'duration'       => $duration,
			'db_time'        => PressTrace_Trace::$db_time,
			'db_count'       => PressTrace_Trace::$db_count,
			'http_time'      => PressTrace_Trace::$http_time,
			'http_count'     => PressTrace_Trace::$http_count,
			'memory_peak_mb' => memory_get_peak_usage() / 1048576,
			'sample_rate'    => (float) $this->settings['sample_rate'],
			'user_logged_in' => $logged_in,
		);
	}

	/**
	 * Gathers the facts used by the namer.
	 *
	 * @return array
	 */
	private function request_facts() {
		// phpcs:disable WordPress.Security.NonceVerification, WordPress.Security.ValidatedSanitizedInput -- values are reduced to slugs by PressTrace_Namer.
		$ctx = array(
			'cli'         => self::is_cli(),
			'cli_args'    => ( self::is_cli() && isset( $GLOBALS['argv'] ) && is_array( $GLOBALS['argv'] ) ) ? array_slice( $GLOBALS['argv'], 1 ) : array(),
			'cron'        => wp_doing_cron(),
			'rest'        => defined( 'REST_REQUEST' ) && REST_REQUEST,
			'rest_route'  => $this->rest_route,
			'method'      => isset( $_SERVER['REQUEST_METHOD'] ) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET',
			'ajax'        => wp_doing_ajax(),
			'ajax_action' => isset( $_REQUEST['action'] ) && is_string( $_REQUEST['action'] ) ? wp_unslash( $_REQUEST['action'] ) : '',
			'wc_ajax'     => isset( $_GET['wc-ajax'] ) && is_string( $_GET['wc-ajax'] ) ? wp_unslash( $_GET['wc-ajax'] ) : '',
			'admin'       => is_admin(),
			'pagenow'     => isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '',
			'admin_page'  => is_admin() && isset( $_GET['page'] ) && is_string( $_GET['page'] ) ? wp_unslash( $_GET['page'] ) : '',
			'script'      => isset( $_SERVER['SCRIPT_NAME'] ) ? basename( (string) $_SERVER['SCRIPT_NAME'] ) : '',
			'xmlrpc'      => defined( 'XMLRPC_REQUEST' ) && XMLRPC_REQUEST,
			'template'    => '',
		);
		// phpcs:enable

		if ( 'frontend' === PressTrace_Namer::type( $ctx ) && isset( $GLOBALS['wp_query'] ) && $GLOBALS['wp_query'] instanceof WP_Query && did_action( 'parse_query' ) ) {
			$ctx['template'] = PressTrace_Namer::template( self::query_flags( $GLOBALS['wp_query'] ) );
		}

		return $ctx;
	}

	/**
	 * Reads conditional flags from the main query.
	 *
	 * @param WP_Query $q Main query.
	 * @return array
	 */
	private static function query_flags( $q ) {
		$object   = $q->get_queried_object();
		$taxonomy = '';
		if ( $q->is_category() ) {
			$taxonomy = 'category';
		} elseif ( $q->is_tag() ) {
			$taxonomy = 'post_tag';
		} elseif ( $object instanceof WP_Term ) {
			$taxonomy = $object->taxonomy;
		}

		$archive_type = $q->get( 'post_type' );
		if ( is_array( $archive_type ) ) {
			$archive_type = reset( $archive_type );
		}

		return array(
			'is_robots'            => $q->is_robots(),
			'is_favicon'           => method_exists( $q, 'is_favicon' ) && $q->is_favicon(),
			'sitemap'              => (string) $q->get( 'sitemap' ),
			'is_404'               => $q->is_404(),
			'is_search'            => $q->is_search(),
			'is_feed'              => $q->is_feed(),
			'is_embed'             => $q->is_embed(),
			'is_front_page'        => $q->is_front_page(),
			'is_home'              => $q->is_home(),
			'is_page'              => $q->is_page(),
			'is_singular'          => $q->is_singular(),
			'post_type'            => $object instanceof WP_Post ? $object->post_type : '',
			'is_post_type_archive' => $q->is_post_type_archive(),
			'archive_post_type'    => is_string( $archive_type ) ? $archive_type : '',
			'is_tax'               => $q->is_tax() || $q->is_category() || $q->is_tag(),
			'taxonomy'             => $taxonomy,
			'is_author'            => $q->is_author(),
			'is_date'              => $q->is_date(),
			'is_archive'           => $q->is_archive(),
		);
	}

	/**
	 * Returns the request URL without query string.
	 *
	 * @return string
	 */
	private function request_url() {
		if ( self::is_cli() || ! isset( $_SERVER['HTTP_HOST'], $_SERVER['REQUEST_URI'] ) ) {
			return '';
		}
		$host = preg_replace( '/[^a-z0-9.:\-\[\]]/i', '', (string) $_SERVER['HTTP_HOST'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- sanitised by the regex.
		$uri  = (string) $_SERVER['REQUEST_URI']; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- reduced to a path by clean_url().
		$path = strtok( $uri, '?#' );
		$path = false === $path ? '/' : $path;
		return PressTrace_Namer::clean_url( ( is_ssl() ? 'https' : 'http' ) . '://' . $host . $path );
	}

	/**
	 * Flushes the response to the client so sending does not delay the visitor.
	 *
	 * @return bool True when the response was finished early.
	 */
	private static function finish_request() {
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			return (bool) fastcgi_finish_request();
		}
		if ( function_exists( 'litespeed_finish_request' ) ) {
			return (bool) litespeed_finish_request();
		}
		return false;
	}

	/**
	 * Returns true when running from the command line.
	 *
	 * @return bool
	 */
	private static function is_cli() {
		return 'cli' === PHP_SAPI || ( defined( 'WP_CLI' ) && WP_CLI );
	}
}
