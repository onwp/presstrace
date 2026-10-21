<?php
/**
 * Settings screen under Tools > PressTrace.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Admin', false ) ) {
	return;
}

/**
 * Admin page, settings registration, Test connection and drop-in reinstall.
 */
final class PressTrace_Admin {

	/**
	 * Page slug.
	 */
	const SLUG = 'presstrace';

	/**
	 * Page hook suffix.
	 *
	 * @var string
	 */
	private static $hook = '';

	/**
	 * Registers admin hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_setting' ) );
		add_action( 'admin_init', array( __CLASS__, 'sync_dropins' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notices' ) );
		add_action( 'wp_ajax_presstrace_test_connection', array( __CLASS__, 'ajax_test_connection' ) );
		add_action( 'admin_post_presstrace_reinstall', array( __CLASS__, 'handle_reinstall' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( PRESSTRACE_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Adds the Tools submenu.
	 *
	 * @return void
	 */
	public static function menu() {
		self::$hook = (string) add_management_page(
			__( 'PressTrace', 'presstrace' ),
			__( 'PressTrace', 'presstrace' ),
			'manage_options',
			self::SLUG,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Registers the option with its sanitiser.
	 *
	 * @return void
	 */
	public static function register_setting() {
		register_setting(
			'presstrace',
			PressTrace_Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'show_in_rest'      => false,
				'default'           => PressTrace_Settings::defaults(),
			)
		);
	}

	/**
	 * Sanitize callback for the option.
	 *
	 * @param mixed $input Submitted value.
	 * @return array
	 */
	public static function sanitize( $input ) {
		$previous = PressTrace_Settings::stored();
		$clean    = PressTrace_Settings::sanitize( $input, $previous, time() );

		if ( is_array( $input ) && isset( $input['app_url'] ) && '' !== trim( (string) $input['app_url'] ) && '' === $clean['app_url'] ) {
			add_settings_error( PressTrace_Settings::OPTION, 'presstrace_app_url', __( 'The app URL must start with http:// or https:// and must not contain credentials.', 'presstrace' ) );
		}
		if ( is_array( $input ) && isset( $input['site_key'] ) && '' !== trim( (string) $input['site_key'] ) && '' === PressTrace_Settings::clean_site_key( $input['site_key'] ) ) {
			add_settings_error( PressTrace_Settings::OPTION, 'presstrace_site_key', __( 'The site key must be "pt_" followed by 40 hexadecimal characters. The previous key was kept.', 'presstrace' ) );
		}
		return $clean;
	}

	/**
	 * Re-installs missing or outdated drop-ins for administrators.
	 *
	 * @return void
	 */
	public static function sync_dropins() {
		if ( current_user_can( 'manage_options' ) && ! wp_doing_ajax() ) {
			PressTrace_Installer::maybe_sync();
		}
	}

	/**
	 * Enqueues the page assets.
	 *
	 * @param string $hook Current page hook.
	 * @return void
	 */
	public static function assets( $hook ) {
		if ( $hook !== self::$hook ) {
			return;
		}
		$url = plugins_url( 'assets/', PRESSTRACE_FILE );
		wp_enqueue_style( 'presstrace-admin', $url . 'admin.css', array(), PRESSTRACE_VERSION );
		wp_enqueue_script( 'presstrace-admin', $url . 'admin.js', array(), PRESSTRACE_VERSION, true );
		wp_localize_script(
			'presstrace-admin',
			'presstraceAdmin',
			array(
				'ajaxUrl' => admin_url( 'admin-ajax.php' ),
				'nonce'   => wp_create_nonce( 'presstrace_test_connection' ),
				'testing' => __( 'Testing connection...', 'presstrace' ),
				'failed'  => __( 'The test request failed. Check your network and try again.', 'presstrace' ),
			)
		);
	}

	/**
	 * Adds a Settings link on the Plugins screen.
	 *
	 * @param string[] $links Links.
	 * @return string[]
	 */
	public static function action_links( $links ) {
		array_unshift(
			$links,
			sprintf( '<a href="%s">%s</a>', esc_url( self::page_url() ), esc_html__( 'Settings', 'presstrace' ) )
		);
		return $links;
	}

	/**
	 * Shows drop-in notices on the Plugins screen.
	 *
	 * @return void
	 */
	public static function notices() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'plugins' !== $screen->id || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$status = PressTrace_Installer::status();

		if ( 'foreign' === $status['db'] ) {
			printf(
				'<div class="notice notice-info"><p>%s</p></div>',
				esc_html( self::fallback_text( $status['db_name'] ) )
			);
		}
		if ( 'ours' !== $status['loader'] ) {
			printf(
				'<div class="notice notice-warning"><p>%s <a href="%s">%s</a></p></div>',
				esc_html__( 'PressTrace could not install its loader in wp-content/mu-plugins, so some plugin load times are not measured.', 'presstrace' ),
				esc_url( self::page_url() ),
				esc_html__( 'Open PressTrace settings', 'presstrace' )
			);
		}
	}

	/**
	 * Explains the foreign db.php fallback mode.
	 *
	 * @param string $name Foreign drop-in name.
	 * @return string
	 */
	private static function fallback_text( $name ) {
		$label = '' !== $name ? $name : 'db.php';
		if ( defined( 'SAVEQUERIES' ) && SAVEQUERIES ) {
			/* translators: %s: name of the other db.php drop-in. */
			return sprintf( __( 'PressTrace: another database drop-in (%s) is installed, so PressTrace runs in fallback mode. Query times come from SAVEQUERIES through the log_query_custom_data filter.', 'presstrace' ), $label );
		}
		/* translators: %s: name of the other db.php drop-in. */
		return sprintf( __( 'PressTrace: another database drop-in (%s) is installed, so PressTrace runs in fallback mode. SAVEQUERIES is off, so queries are counted but not timed.', 'presstrace' ), $label );
	}

	/**
	 * Test connection: GET {app_url}/api/v1/ping with the saved key.
	 *
	 * @return void
	 */
	public static function ajax_test_connection() {
		check_ajax_referer( 'presstrace_test_connection', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'You are not allowed to do this.', 'presstrace' ) ), 403 );
		}

		$settings = PressTrace_Settings::get();
		if ( ! PressTrace_Settings::is_configured( $settings ) ) {
			wp_send_json_error( array( 'message' => __( 'Save an app URL and a site key first.', 'presstrace' ) ) );
		}

		$response = wp_remote_get(
			$settings['app_url'] . '/api/v1/ping',
			array(
				'timeout'     => 5,
				'redirection' => 0,
				'headers'     => array(
					'Authorization'      => 'Bearer ' . $settings['site_key'],
					'X-PressTrace-Agent' => PRESSTRACE_VERSION,
				),
				'user-agent'  => 'PressTrace/' . PRESSTRACE_VERSION,
			)
		);

		if ( is_wp_error( $response ) ) {
			/* translators: %s: error message. */
			wp_send_json_error( array( 'message' => sprintf( __( 'Could not reach the app: %s', 'presstrace' ), $response->get_error_message() ) ) );
		}

		$code = (int) wp_remote_retrieve_response_code( $response );
		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( 200 === $code && is_array( $body ) && ! empty( $body['ok'] ) ) {
			$name = isset( $body['site']['name'] ) && is_string( $body['site']['name'] ) ? $body['site']['name'] : '';
			wp_send_json_success(
				array(
					'message' => '' !== $name
						/* translators: %s: site name in the PressTrace app. */
						? sprintf( __( 'Connected. The app knows this site as "%s".', 'presstrace' ), $name )
						: __( 'Connected.', 'presstrace' ),
				)
			);
		}
		if ( 401 === $code ) {
			wp_send_json_error( array( 'message' => __( 'The app rejected the site key (HTTP 401). Copy the key again from the app.', 'presstrace' ) ) );
		}
		/* translators: %d: HTTP status code. */
		wp_send_json_error( array( 'message' => sprintf( __( 'Unexpected response from the app (HTTP %d). Check the app URL.', 'presstrace' ), $code ) ) );
	}

	/**
	 * Reinstall button handler.
	 *
	 * @return void
	 */
	public static function handle_reinstall() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to do this.', 'presstrace' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( 'presstrace_reinstall', '_presstrace_nonce' );

		delete_transient( 'presstrace_sync_failed' );
		$result = PressTrace_Installer::install();

		wp_safe_redirect(
			add_query_arg(
				array(
					'presstrace_loader' => $result['loader'] ? '1' : '0',
					'presstrace_db'     => $result['db'] ? '1' : '0',
				),
				self::page_url()
			)
		);
		exit;
	}

	/**
	 * Settings page URL.
	 *
	 * @return string
	 */
	private static function page_url() {
		return admin_url( 'tools.php?page=' . self::SLUG );
	}

	/**
	 * Renders the page.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings   = PressTrace_Settings::get();
		$stored     = PressTrace_Settings::stored();
		$constants  = PressTrace_Settings::constants();
		$status     = PressTrace_Installer::status();
		$configured = PressTrace_Settings::is_configured( $settings );
		$monitoring = PressTrace_Settings::is_monitoring( $settings, time() );
		$option     = PressTrace_Settings::OPTION;
		$format     = get_option( 'date_format' ) . ' ' . get_option( 'time_format' );

		if ( ! $configured ) {
			$state = array( 'off', __( 'Not configured', 'presstrace' ), __( 'Add the app URL and the site key from your PressTrace app.', 'presstrace' ) );
		} elseif ( ! $monitoring && ! empty( $settings['enabled'] ) && 'always' !== $settings['window'] && (int) $settings['enabled_until'] > 0 ) {
			/* translators: %s: date and time. */
			$state = array( 'paused', __( 'Monitoring off', 'presstrace' ), sprintf( __( 'The monitoring window ended on %s. Save the settings to start a new window.', 'presstrace' ), wp_date( $format, (int) $settings['enabled_until'] ) ) );
		} elseif ( ! $monitoring ) {
			$state = array( 'paused', __( 'Monitoring off', 'presstrace' ), __( 'The agent is dormant. Turn on monitoring to send traces.', 'presstrace' ) );
		} elseif ( 'always' === $settings['window'] ) {
			$state = array( 'on', __( 'Monitoring on', 'presstrace' ), __( 'Traces are sent with no time limit.', 'presstrace' ) );
		} else {
			/* translators: %s: date and time. */
			$state = array( 'on', __( 'Monitoring on', 'presstrace' ), sprintf( __( 'Enabled until %s.', 'presstrace' ), wp_date( $format, (int) $settings['enabled_until'] ) ) );
		}

		$windows = array(
			'2h'     => __( '2 hours', 'presstrace' ),
			'4h'     => __( '4 hours', 'presstrace' ),
			'12h'    => __( '12 hours', 'presstrace' ),
			'24h'    => __( '24 hours', 'presstrace' ),
			'always' => __( 'Always', 'presstrace' ),
		);

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display of the redirect result only.
		$reinstalled = isset( $_GET['presstrace_loader'], $_GET['presstrace_db'] );
		$loader_ok   = $reinstalled && '1' === $_GET['presstrace_loader'];
		$db_ok       = $reinstalled && '1' === $_GET['presstrace_db'];
		// phpcs:enable
		?>
		<div class="wrap presstrace">
			<h1><?php esc_html_e( 'PressTrace', 'presstrace' ); ?></h1>

			<?php settings_errors(); ?>

			<?php if ( $reinstalled ) : ?>
				<div class="notice <?php echo esc_attr( $loader_ok ? 'notice-success' : 'notice-error' ); ?> is-dismissible">
					<p>
						<?php
						echo esc_html(
							$loader_ok
								? __( 'Drop-ins reinstalled.', 'presstrace' )
								: __( 'The loader could not be written. Make sure wp-content/mu-plugins is writable by the web server.', 'presstrace' )
						);
						if ( $loader_ok && ! $db_ok && 'foreign' === $status['db'] ) {
							echo ' ' . esc_html__( 'The database drop-in was left alone because another db.php is installed.', 'presstrace' );
						}
						?>
					</p>
				</div>
			<?php endif; ?>

			<div class="card presstrace-card">
				<h2 class="title"><?php esc_html_e( 'Status', 'presstrace' ); ?></h2>
				<p class="presstrace-status">
					<span class="presstrace-dot presstrace-dot--<?php echo esc_attr( $state[0] ); ?>" aria-hidden="true"></span>
					<strong><?php echo esc_html( $state[1] ); ?></strong>
				</p>
				<p><?php echo esc_html( $state[2] ); ?></p>
				<?php if ( '' !== $settings['app_url'] ) : ?>
					<p>
						<a class="button" href="<?php echo esc_url( $settings['app_url'] ); ?>" target="_blank" rel="noopener noreferrer">
							<?php esc_html_e( 'Open dashboard', 'presstrace' ); ?>
							<span class="screen-reader-text"><?php esc_html_e( '(opens in a new tab)', 'presstrace' ); ?></span>
						</a>
					</p>
				<?php endif; ?>
			</div>

			<form method="post" action="options.php" class="card presstrace-card">
				<?php settings_fields( 'presstrace' ); ?>

				<h2 class="title"><?php esc_html_e( 'Connection', 'presstrace' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="presstrace-app-url"><?php esc_html_e( 'App URL', 'presstrace' ); ?></label></th>
						<td>
							<input type="url" id="presstrace-app-url" class="regular-text code" name="<?php echo esc_attr( $option ); ?>[app_url]" value="<?php echo esc_attr( $settings['app_url'] ); ?>" placeholder="https://apm.example.com" aria-describedby="presstrace-app-url-desc" <?php disabled( isset( $constants['app_url'] ) ); ?>>
							<p class="description" id="presstrace-app-url-desc">
								<?php
								echo esc_html(
									isset( $constants['app_url'] )
										? __( 'Set by PRESSTRACE_APP_URL in wp-config.php.', 'presstrace' )
										: __( 'Address of your PressTrace app, without a trailing slash.', 'presstrace' )
								);
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="presstrace-site-key"><?php esc_html_e( 'Site key', 'presstrace' ); ?></label></th>
						<td>
							<input type="password" id="presstrace-site-key" class="regular-text code" name="<?php echo esc_attr( $option ); ?>[site_key]" value="" autocomplete="off" spellcheck="false" placeholder="<?php echo esc_attr( '' !== $settings['site_key'] ? PressTrace_Settings::mask_key( $settings['site_key'] ) : 'pt_...' ); ?>" aria-describedby="presstrace-site-key-desc" <?php disabled( isset( $constants['site_key'] ) ); ?>>
							<p class="description" id="presstrace-site-key-desc">
								<?php
								if ( isset( $constants['site_key'] ) ) {
									esc_html_e( 'Set by PRESSTRACE_SITE_KEY in wp-config.php.', 'presstrace' );
								} elseif ( '' !== $stored['site_key'] ) {
									/* translators: %s: masked site key. */
									echo esc_html( sprintf( __( 'Saved key: %s. Leave empty to keep it.', 'presstrace' ), PressTrace_Settings::mask_key( $stored['site_key'] ) ) );
								} else {
									esc_html_e( 'Shown once when you add the site in the app.', 'presstrace' );
								}
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Test', 'presstrace' ); ?></th>
						<td>
							<button type="button" class="button" id="presstrace-test" <?php disabled( ! $configured ); ?>><?php esc_html_e( 'Test connection', 'presstrace' ); ?></button>
							<p class="description"><?php esc_html_e( 'Uses the saved settings. Save first after changing them.', 'presstrace' ); ?></p>
							<p id="presstrace-test-result" class="presstrace-test-result" role="status" aria-live="polite"></p>
						</td>
					</tr>
				</table>

				<h2 class="title"><?php esc_html_e( 'Monitoring', 'presstrace' ); ?></h2>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><?php esc_html_e( 'Monitoring', 'presstrace' ); ?></th>
						<td>
							<label for="presstrace-enabled">
								<input type="checkbox" id="presstrace-enabled" name="<?php echo esc_attr( $option ); ?>[enabled]" value="1" <?php checked( ! empty( $settings['enabled'] ) ); ?> <?php disabled( ! empty( $constants['always_on'] ) ); ?>>
								<?php esc_html_e( 'Send traces to the app', 'presstrace' ); ?>
							</label>
							<?php if ( ! empty( $constants['always_on'] ) ) : ?>
								<p class="description"><?php esc_html_e( 'Always on: set by PRESSTRACE_ALWAYS_ON in wp-config.php.', 'presstrace' ); ?></p>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="presstrace-window"><?php esc_html_e( 'Monitoring window', 'presstrace' ); ?></label></th>
						<td>
							<select id="presstrace-window" name="<?php echo esc_attr( $option ); ?>[window]" aria-describedby="presstrace-window-desc" <?php disabled( ! empty( $constants['always_on'] ) ); ?>>
								<?php foreach ( $windows as $value => $label ) : ?>
									<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $settings['window'], $value ); ?>><?php echo esc_html( $label ); ?></option>
								<?php endforeach; ?>
							</select>
							<p class="description" id="presstrace-window-desc">
								<?php
								if ( $monitoring && 'always' !== $settings['window'] ) {
									/* translators: %s: date and time. */
									echo esc_html( sprintf( __( 'Enabled until %s. Saving restarts the window.', 'presstrace' ), wp_date( $format, (int) $settings['enabled_until'] ) ) );
								} else {
									esc_html_e( 'Monitoring turns itself off when the window ends. Saving restarts the window.', 'presstrace' );
								}
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="presstrace-sample-rate"><?php esc_html_e( 'Sample rate', 'presstrace' ); ?></label></th>
						<td>
							<input type="number" id="presstrace-sample-rate" class="small-text" name="<?php echo esc_attr( $option ); ?>[sample_rate]" value="<?php echo esc_attr( (string) $settings['sample_rate'] ); ?>" min="0" max="1" step="0.01" inputmode="decimal" aria-describedby="presstrace-sample-rate-desc" <?php disabled( isset( $constants['sample_rate'] ) ); ?>>
							<p class="description" id="presstrace-sample-rate-desc">
								<?php
								echo esc_html(
									isset( $constants['sample_rate'] )
										? __( 'Set by PRESSTRACE_SAMPLE_RATE in wp-config.php.', 'presstrace' )
										: __( 'Share of requests to trace, from 0 to 1. 1 traces every request, 0.1 traces one in ten.', 'presstrace' )
								);
								?>
							</p>
						</td>
					</tr>
				</table>

				<?php submit_button( __( 'Save settings', 'presstrace' ) ); ?>
			</form>

			<div class="card presstrace-card">
				<h2 class="title"><?php esc_html_e( 'Drop-ins', 'presstrace' ); ?></h2>
				<table class="widefat striped presstrace-dropins">
					<thead>
						<tr>
							<th scope="col"><?php esc_html_e( 'File', 'presstrace' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Status', 'presstrace' ); ?></th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td><code>mu-plugins/<?php echo esc_html( PressTrace_Installer::LOADER ); ?></code></td>
							<td><?php echo esc_html( self::loader_label( $status['loader'] ) ); ?></td>
						</tr>
						<tr>
							<td><code>db.php</code></td>
							<td><?php echo esc_html( self::db_label( $status['db'], $status['db_name'] ) ); ?></td>
						</tr>
					</tbody>
				</table>
				<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" class="presstrace-inline-form">
					<input type="hidden" name="action" value="presstrace_reinstall">
					<?php wp_nonce_field( 'presstrace_reinstall', '_presstrace_nonce' ); ?>
					<?php submit_button( __( 'Reinstall drop-ins', 'presstrace' ), 'secondary', 'presstrace-reinstall', false ); ?>
				</form>
			</div>

			<div class="card presstrace-card">
				<h2 class="title"><?php esc_html_e( 'Trace one request', 'presstrace' ); ?></h2>
				<p>
					<?php
					printf(
						/* translators: %s: the query parameter. */
						esc_html__( 'While logged in as an administrator, add %s to any URL to trace that request, even when monitoring is off or the request would not be sampled. The app URL and site key must be saved.', 'presstrace' ),
						'<code>?presstrace_force=1</code>'
					);
					?>
				</p>
			</div>
		</div>
		<?php
	}

	/**
	 * Label for the loader status.
	 *
	 * @param string $status Status.
	 * @return string
	 */
	private static function loader_label( $status ) {
		switch ( $status ) {
			case 'ours':
				return __( 'Installed. The agent starts before other plugins.', 'presstrace' );
			case 'outdated':
				return __( 'Installed, older version. Reinstall to update it.', 'presstrace' );
			case 'foreign':
				return __( 'Another file with this name exists. Remove it and reinstall.', 'presstrace' );
			default:
				return __( 'Missing. The agent starts late and misses some plugin load times.', 'presstrace' );
		}
	}

	/**
	 * Label for the db.php status.
	 *
	 * @param string $status Status.
	 * @param string $name   Foreign drop-in name.
	 * @return string
	 */
	private static function db_label( $status, $name ) {
		switch ( $status ) {
			case 'ours':
				return __( 'Installed. Every query is timed.', 'presstrace' );
			case 'outdated':
				return __( 'Installed, older version. Reinstall to update it.', 'presstrace' );
			case 'foreign':
				return self::fallback_text( $name );
			default:
				return __( 'Missing. Reinstall to time every query.', 'presstrace' );
		}
	}
}
