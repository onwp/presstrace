<?php
/**
 * Transaction naming, typing and URL helpers.
 *
 * @package PressTrace
 */

defined( 'ABSPATH' ) || exit;

if ( class_exists( 'PressTrace_Namer', false ) ) {
	return;
}

/**
 * Pure functions that turn request facts into a transaction name and type.
 */
final class PressTrace_Namer {

	/**
	 * Returns the transaction type for the given request facts.
	 *
	 * @param array $ctx Facts: cli, cron, rest, ajax, wc_ajax, admin.
	 * @return string One of frontend, admin, rest, ajax, cron, cli.
	 */
	public static function type( array $ctx ) {
		if ( ! empty( $ctx['cli'] ) ) {
			return 'cli';
		}
		if ( ! empty( $ctx['cron'] ) ) {
			return 'cron';
		}
		if ( ! empty( $ctx['rest'] ) ) {
			return 'rest';
		}
		if ( ! empty( $ctx['ajax'] ) || ( isset( $ctx['wc_ajax'] ) && '' !== (string) $ctx['wc_ajax'] ) ) {
			return 'ajax';
		}
		if ( ! empty( $ctx['admin'] ) ) {
			return 'admin';
		}
		return 'frontend';
	}

	/**
	 * Returns the transaction name for the given request facts.
	 *
	 * @param array $ctx Facts: see type() plus method, rest_route, ajax_action, pagenow, admin_page, script, cli_args, template.
	 * @return string
	 */
	public static function name( array $ctx ) {
		switch ( self::type( $ctx ) ) {
			case 'cli':
				$args = isset( $ctx['cli_args'] ) ? array_values( (array) $ctx['cli_args'] ) : array();
				$cmd  = array();
				foreach ( $args as $arg ) {
					$arg = (string) $arg;
					if ( '' === $arg || '-' === $arg[0] ) {
						continue;
					}
					// Only command words (wp plugin list), never free-form arguments such as eval code.
					if ( ! preg_match( '/^[a-z][a-z0-9_:-]{0,39}$/i', $arg ) ) {
						break;
					}
					$cmd[] = $arg;
					if ( count( $cmd ) >= 2 ) {
						break;
					}
				}
				return trim( 'wp-cli ' . implode( ' ', array_filter( $cmd, 'strlen' ) ) );

			case 'cron':
				return 'wp-cron';

			case 'rest':
				$method = self::method( isset( $ctx['method'] ) ? $ctx['method'] : 'GET' );
				$route  = isset( $ctx['rest_route'] ) && '' !== (string) $ctx['rest_route'] ? self::rest_route( (string) $ctx['rest_route'] ) : 'unmatched';
				return 'REST ' . $method . ' ' . $route;

			case 'ajax':
				if ( isset( $ctx['wc_ajax'] ) && '' !== (string) $ctx['wc_ajax'] ) {
					return 'wc-ajax ' . self::slug( $ctx['wc_ajax'] );
				}
				$action = isset( $ctx['ajax_action'] ) ? self::slug( $ctx['ajax_action'] ) : '';
				return '' === $action ? 'admin-ajax' : 'admin-ajax ' . $action;

			case 'admin':
				$page = isset( $ctx['pagenow'] ) && '' !== (string) $ctx['pagenow'] ? self::slug( $ctx['pagenow'] ) : 'index.php';
				$name = 'wp-admin/' . $page;
				if ( isset( $ctx['admin_page'] ) && '' !== (string) $ctx['admin_page'] ) {
					$name .= '?page=' . self::slug( $ctx['admin_page'] );
				}
				return $name;
		}

		$script = isset( $ctx['script'] ) ? (string) $ctx['script'] : '';
		if ( 'wp-login.php' === $script || 'xmlrpc.php' === $script ) {
			return $script;
		}
		if ( ! empty( $ctx['xmlrpc'] ) ) {
			return 'xmlrpc.php';
		}

		$template = isset( $ctx['template'] ) ? (string) $ctx['template'] : '';
		if ( '' !== $template ) {
			return $template;
		}
		// Standalone entry points such as wp-comments-post.php or wp-signup.php.
		if ( '' !== $script && 'index.php' !== $script ) {
			return self::slug( $script );
		}
		return 'unknown';
	}

	/**
	 * Picks the template name from WordPress conditional flags.
	 *
	 * @param array $q Flags: is_robots, is_favicon, is_404, is_search, is_front_page, is_home, is_embed, is_feed,
	 *                 is_page, is_singular, post_type, is_post_type_archive, archive_post_type, is_tax, taxonomy,
	 *                 is_author, is_date, is_archive, sitemap.
	 * @return string
	 */
	public static function template( array $q ) {
		$f = static function ( $key ) use ( $q ) {
			return ! empty( $q[ $key ] );
		};

		if ( $f( 'is_robots' ) ) {
			return 'robots.txt';
		}
		if ( $f( 'is_favicon' ) ) {
			return 'favicon.ico';
		}
		if ( isset( $q['sitemap'] ) && '' !== (string) $q['sitemap'] ) {
			return 'sitemap';
		}
		if ( $f( 'is_404' ) ) {
			return '404';
		}
		if ( $f( 'is_search' ) ) {
			return 'search';
		}
		if ( $f( 'is_feed' ) ) {
			return 'feed';
		}
		if ( $f( 'is_embed' ) ) {
			return 'embed';
		}
		if ( $f( 'is_front_page' ) ) {
			return 'front-page';
		}
		if ( $f( 'is_home' ) ) {
			return 'home';
		}
		if ( $f( 'is_page' ) ) {
			return 'page';
		}
		if ( $f( 'is_singular' ) ) {
			$type = isset( $q['post_type'] ) ? self::slug( $q['post_type'] ) : '';
			return '' === $type ? 'single' : 'single-' . $type;
		}
		if ( $f( 'is_post_type_archive' ) ) {
			$type = isset( $q['archive_post_type'] ) ? self::slug( $q['archive_post_type'] ) : '';
			return '' === $type ? 'archive' : 'archive-' . $type;
		}
		if ( $f( 'is_tax' ) ) {
			$tax = isset( $q['taxonomy'] ) ? self::slug( $q['taxonomy'] ) : '';
			return '' === $tax ? 'taxonomy' : 'taxonomy-' . $tax;
		}
		if ( $f( 'is_author' ) ) {
			return 'author';
		}
		if ( $f( 'is_date' ) ) {
			return 'date';
		}
		if ( $f( 'is_archive' ) ) {
			return 'archive';
		}
		return '';
	}

	/**
	 * Turns a REST route regex into a readable pattern: "/wp/v2/posts/(?P<id>[\d]+)" becomes "/wp/v2/posts/{id}".
	 *
	 * @param string $route Route pattern.
	 * @return string
	 */
	public static function rest_route( $route ) {
		$out     = '';
		$len     = strlen( $route );
		$i       = 0;
		$unnamed = 0;

		while ( $i < $len ) {
			$char = $route[ $i ];
			if ( '(' !== $char ) {
				$out .= $char;
				++$i;
				continue;
			}

			// Find the matching closing parenthesis, honouring escapes and nesting.
			$depth = 0;
			$j     = $i;
			for ( ; $j < $len; $j++ ) {
				if ( '\\' === $route[ $j ] ) {
					++$j;
					continue;
				}
				if ( '(' === $route[ $j ] ) {
					++$depth;
				} elseif ( ')' === $route[ $j ] ) {
					--$depth;
					if ( 0 === $depth ) {
						break;
					}
				}
			}

			$group = substr( $route, $i, $j - $i + 1 );
			if ( preg_match( '/^\(\?P?<([a-zA-Z_][a-zA-Z0-9_]*)>/', $group, $m ) ) {
				$out .= '{' . $m[1] . '}';
			} else {
				++$unnamed;
				$out .= '{param' . $unnamed . '}';
			}
			$i = $j + 1;
		}

		$out = str_replace( array( '^', '$' ), '', $out );
		return '' === $out ? '/' : $out;
	}

	/**
	 * Removes query string, fragment and credentials from a URL.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	public static function clean_url( $url ) {
		$url   = (string) $url;
		$parts = parse_url( $url ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure helper, no WP dependency.
		if ( false === $parts || ! isset( $parts['host'] ) ) {
			$cut = strcspn( $url, '?#' );
			return substr( $url, 0, $cut );
		}

		$out = ( isset( $parts['scheme'] ) ? strtolower( $parts['scheme'] ) . '://' : '//' ) . strtolower( $parts['host'] );
		if ( isset( $parts['port'] ) ) {
			$out .= ':' . (int) $parts['port'];
		}
		$out .= isset( $parts['path'] ) ? $parts['path'] : '/';
		return $out;
	}

	/**
	 * Returns the host of a URL, or an empty string.
	 *
	 * @param string $url URL.
	 * @return string
	 */
	public static function host( $url ) {
		$host = parse_url( (string) $url, PHP_URL_HOST ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure helper.
		return is_string( $host ) ? strtolower( $host ) : '';
	}

	/**
	 * Normalises an HTTP method.
	 *
	 * @param string $method Method.
	 * @return string
	 */
	public static function method( $method ) {
		$method = strtoupper( preg_replace( '/[^a-z]/i', '', (string) $method ) );
		return '' === $method ? 'GET' : substr( $method, 0, 10 );
	}

	/**
	 * Sanitises an action, page or post type slug for use in a name.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	public static function slug( $value ) {
		if ( ! is_scalar( $value ) ) {
			return '';
		}
		return substr( preg_replace( '/[^a-zA-Z0-9_.\/:-]/', '', (string) $value ), 0, 100 );
	}
}
